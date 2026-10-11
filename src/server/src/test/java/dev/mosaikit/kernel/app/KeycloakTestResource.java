// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import io.quarkus.test.common.QuarkusTestResourceLifecycleManager;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;

/**
 * Keycloak for the federation tests (MK-012). It uses the Keycloak at {@code
 * -Dit.keycloak.url} (admin {@code admin}/{@code admin}) when given, otherwise it starts
 * one in a container. Each run creates two realms from {@code
 * src/server/src/main/resources/dev/mosaikit/kernel/core/identity/realm-template.json} with random names, so a shared Keycloak can be
 * reused, and enables the password grant on their client for the tests only.
 */
public class KeycloakTestResource implements QuarkusTestResourceLifecycleManager {

    static final String IMAGE = "quay.io/keycloak/keycloak:26.7.4";
    static final String PASSWORD = "a realm password";

    /** Base URL of the running Keycloak, set by {@link #start()}. */
    static volatile String url;

    /** Realm of the organization {@code acme} of the tests. */
    static final String ACME = "acme-" + UUID.randomUUID().toString().substring(0, 8);

    /** Realm of the organization {@code globex} of the tests. */
    static final String GLOBEX = "globex-" + UUID.randomUUID().toString().substring(0, 8);

    private static final ObjectMapper JSON = new ObjectMapper();
    private final HttpClient http =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    private GenericContainer<?> container;

    @Override
    public Map<String, String> start() {
        String external = System.getProperty("it.keycloak.url");
        if (external != null && !external.isBlank()) {
            url = external.endsWith("/") ? external.substring(0, external.length() - 1) : external;
        } else {
            container = new GenericContainer<>(IMAGE)
                    .withCommand("start-dev")
                    .withEnv("KC_BOOTSTRAP_ADMIN_USERNAME", "admin")
                    .withEnv("KC_BOOTSTRAP_ADMIN_PASSWORD", "admin")
                    .withExposedPorts(8080)
                    .waitingFor(Wait.forHttp("/realms/master").forPort(8080))
                    .withStartupTimeout(Duration.ofMinutes(3));
            container.start();
            url = "http://" + container.getHost() + ":" + container.getMappedPort(8080);
        }
        String admin = adminToken();
        createRealm(
                admin,
                ACME,
                Map.of("alice", email("alice", ACME), "bob", email("bob", ACME), "carol", email("carol", ACME)));
        // The intruder of globex claims the address of an account of acme.
        // dave and erin have local accounts in acme; only dave is made a member of globex (MK-017).
        createRealm(
                admin,
                GLOBEX,
                Map.of(
                        "gina", email("gina", GLOBEX),
                        "intruder", email("carol", ACME),
                        "dave", email("dave", ACME),
                        "erin", email("erin", ACME)));
        var config = new java.util.HashMap<String, String>();
        config.put("mosaikit.identity.keycloak-url", url);
        config.put("mosaikit.identity.domain", "mosaikit.test");
        // The service account with which the kernel creates realms (MK-018).
        createAdministrationClient(admin);
        config.put("mosaikit.identity.admin.client-id", ADMIN_CLIENT);
        config.put("mosaikit.identity.admin.client-secret", ADMIN_SECRET);
        if (url.contains("//localhost:")) {
            // The kernel reaches Keycloak by another name than the browsers, as in Docker Compose:
            // tokens say localhost, the kernel fetches the keys from 127.0.0.1.
            config.put("mosaikit.identity.keycloak-internal-url", url.replace("//localhost:", "//127.0.0.1:"));
        }
        return config;
    }

    @Override
    public void stop() {
        if (container != null) {
            container.stop();
        } else if (url != null) {
            String admin = adminToken();
            var realms = new java.util.ArrayList<>(List.of(ACME, GLOBEX));
            realms.addAll(CREATED_BY_TESTS);
            for (String realm : realms) {
                try {
                    send(HttpRequest.newBuilder(URI.create(url + "/admin/realms/" + realm))
                            .header("Authorization", "Bearer " + admin)
                            .DELETE());
                } catch (IllegalStateException _) {
                    // Already gone.
                }
            }
        }
    }

    /** Email address of a test user: the email domain of each organization is {@code <realm>.test}. */
    static String email(String user, String realm) {
        return user + "@" + realm + ".test";
    }

    /** Realms created by the tests, deleted with the others on a shared Keycloak. */
    static final java.util.Set<String> CREATED_BY_TESTS = java.util.concurrent.ConcurrentHashMap.newKeySet();

    /** Client of the master realm with the admin role, as KC_BOOTSTRAP_ADMIN_CLIENT_ID creates. */
    static final String ADMIN_CLIENT = "mosaikit-it-admin";

    static final String ADMIN_SECRET = "a secret for the tests only";

    private void createAdministrationClient(String admin) {
        String clients = url + "/admin/realms/master/clients";
        var client = JSON.createObjectNode()
                .put("clientId", ADMIN_CLIENT)
                .put("secret", ADMIN_SECRET)
                .put("publicClient", false)
                .put("serviceAccountsEnabled", true)
                .put("standardFlowEnabled", false)
                .put("directAccessGrantsEnabled", false);
        try {
            HttpResponse<String> created = http.send(
                    HttpRequest.newBuilder(URI.create(clients))
                            .header("Authorization", "Bearer " + admin)
                            .header("Content-Type", "application/json")
                            .POST(HttpRequest.BodyPublishers.ofString(client.toString()))
                            .build(),
                    HttpResponse.BodyHandlers.ofString());
            if (created.statusCode() == 409) {
                return; // Created by an earlier run on a shared Keycloak, with the same secret.
            }
            if (created.statusCode() != 201) {
                throw new IllegalStateException("Cannot create the admin client: " + created.body());
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
        String id = read(send(HttpRequest.newBuilder(URI.create(clients + "?clientId=" + ADMIN_CLIENT))
                        .header("Authorization", "Bearer " + admin)))
                .get(0)
                .path("id")
                .asText();
        String user = read(send(HttpRequest.newBuilder(URI.create(clients + "/" + id + "/service-account-user"))
                        .header("Authorization", "Bearer " + admin)))
                .path("id")
                .asText();
        String role = send(HttpRequest.newBuilder(URI.create(url + "/admin/realms/master/roles/admin"))
                .header("Authorization", "Bearer " + admin));
        send(HttpRequest.newBuilder(URI.create(url + "/admin/realms/master/users/" + user + "/role-mappings/realm"))
                .header("Authorization", "Bearer " + admin)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("[" + role + "]")));
    }

    /** A document of the Keycloak administration API, read as the test admin. */
    static com.fasterxml.jackson.databind.JsonNode admin(String path) {
        var resource = new KeycloakTestResource();
        return resource.read(resource.send(HttpRequest.newBuilder(URI.create(url + path))
                .header("Authorization", "Bearer " + resource.adminToken())));
    }

    /** Creates an empty realm, as someone could have done by hand. */
    static void createEmptyRealm(String realm) {
        var resource = new KeycloakTestResource();
        resource.send(HttpRequest.newBuilder(URI.create(url + "/admin/realms"))
                .header("Authorization", "Bearer " + resource.adminToken())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{\"realm\":\"" + realm + "\",\"enabled\":true}")));
    }

    private com.fasterxml.jackson.databind.JsonNode read(String body) {
        try {
            return JSON.readTree(body);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** An access token of a user of a test realm, obtained with the password grant. */
    static String token(String realm, String username) {
        var response = HttpClient.newHttpClient();
        try {
            var body = form(Map.of(
                    "grant_type", "password",
                    "client_id", "mosaikit",
                    "scope", "openid",
                    "username", username,
                    "password", PASSWORD));
            var reply = response.send(
                    HttpRequest.newBuilder(URI.create(url + "/realms/" + realm + "/protocol/openid-connect/token"))
                            .header("Content-Type", "application/x-www-form-urlencoded")
                            .POST(HttpRequest.BodyPublishers.ofString(body))
                            .build(),
                    HttpResponse.BodyHandlers.ofString());
            if (reply.statusCode() != 200) {
                throw new IllegalStateException("Token request failed: " + reply.statusCode() + " " + reply.body());
            }
            return JSON.readTree(reply.body()).get("access_token").asText();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    private String adminToken() {
        String body = form(
                Map.of("grant_type", "password", "client_id", "admin-cli", "username", "admin", "password", "admin"));
        String reply = send(HttpRequest.newBuilder(URI.create(url + "/realms/master/protocol/openid-connect/token"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body)));
        try {
            return JSON.readTree(reply).get("access_token").asText();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** Imports the realm template, with the given test users and their email addresses. */
    private void createRealm(String admin, String realm, Map<String, String> users) {
        ObjectNode template;
        try {
            template = (ObjectNode) JSON.readTree(Files.readString(
                    Path.of("src/main/resources/dev/mosaikit/kernel/core/identity/realm-template.json")));
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        template.put("realm", realm).put("displayName", realm);
        var client = (ObjectNode) template.withArray("clients").get(0);
        client.put("directAccessGrantsEnabled", true);
        client.putArray("redirectUris").add("http://localhost/*");
        // A realm role that must never become a kernel role.
        ((ArrayNode) template.with("roles").withArray("realm")).addObject().put("name", "platform-admin");
        var userArray = template.putArray("users");
        for (var entry : users.entrySet()) {
            String user = entry.getKey();
            var node = userArray
                    .addObject()
                    .put("username", user)
                    .put("email", entry.getValue())
                    .put("emailVerified", true)
                    .put("enabled", true)
                    .put("firstName", Character.toUpperCase(user.charAt(0)) + user.substring(1))
                    .put("lastName", "Tester");
            node.putArray("credentials")
                    .addObject()
                    .put("type", "password")
                    .put("value", PASSWORD)
                    .put("temporary", false);
            var roles = node.putArray("realmRoles").add("default-roles-" + realm);
            if (user.equals("alice")) {
                roles.add("organization-admin").add("platform-admin");
            }
        }
        send(HttpRequest.newBuilder(URI.create(url + "/admin/realms"))
                .header("Authorization", "Bearer " + admin)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(template.toString())));
    }

    private String send(HttpRequest.Builder request) {
        try {
            var reply = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
            if (reply.statusCode() >= 300) {
                throw new IllegalStateException("Keycloak answered " + reply.statusCode() + ": " + reply.body());
            }
            return reply.body();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    private static String form(Map<String, String> values) {
        return values.entrySet().stream()
                .map(entry -> entry.getKey() + "=" + URLEncoder.encode(entry.getValue(), StandardCharsets.UTF_8))
                .collect(Collectors.joining("&"));
    }
}
