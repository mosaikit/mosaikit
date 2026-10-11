// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import jakarta.enterprise.context.ApplicationScoped;
import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import org.jboss.logging.Logger;

/**
 * Calls the administration API of Keycloak with the service account of the kernel
 * ({@code mosaikit.identity.admin}), at the internal URL of Keycloak when one is set.
 */
@ApplicationScoped
public class KeycloakAdministration {

    private static final Logger LOG = Logger.getLogger(KeycloakAdministration.class);
    private static final Duration TIMEOUT = Duration.ofSeconds(15);

    private final KernelConfig.Identity config;
    private final ObjectMapper json;
    private final HttpClient http =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    public KeycloakAdministration(KernelConfig config, ObjectMapper json) {
        this.config = config.identity();
        this.json = json;
    }

    /** Whether the kernel can create realms: a Keycloak URL and a service account are set. */
    public boolean available() {
        return config.keycloakUrl().isPresent() && config.admin().isPresent();
    }

    /**
     * Creates a realm from its representation, users and roles included.
     *
     * @throws ConflictException if a realm with the same name exists
     * @throws ServiceUnavailableException if Keycloak cannot be reached or refuses the request
     */
    public void createRealm(JsonNode realm) {
        HttpResponse<String> response = send(HttpRequest.newBuilder(uri("/admin/realms"))
                .header("Authorization", "Bearer " + token())
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(realm.toString())));
        if (response.statusCode() == 409) {
            throw new ConflictException(
                    "Keycloak already has a realm named '" + realm.path("realm").asText() + "'.");
        }
        if (response.statusCode() >= 300) {
            LOG.warnf(
                    "Keycloak refused the realm %s: %d %s",
                    realm.path("realm").asText(), response.statusCode(), response.body());
            throw new ServiceUnavailableException(
                    "Keycloak refused to create the realm (HTTP " + response.statusCode() + ").");
        }
    }

    /** Deletes a realm, to undo a creation; failures are only logged. */
    public void deleteRealm(String realm) {
        try {
            send(HttpRequest.newBuilder(uri("/admin/realms/" + URLEncoder.encode(realm, StandardCharsets.UTF_8)))
                    .header("Authorization", "Bearer " + token())
                    .DELETE());
        } catch (ServiceUnavailableException e) {
            LOG.warnf("Realm %s could not be deleted after a failed creation: %s", realm, e.getMessage());
        }
    }

    private String token() {
        KernelConfig.Identity.Admin admin = config.admin()
                .orElseThrow(() -> new ServiceUnavailableException("The Keycloak administration client is not set."));
        String body = "grant_type=client_credentials&client_id="
                + URLEncoder.encode(admin.clientId(), StandardCharsets.UTF_8) + "&client_secret="
                + URLEncoder.encode(admin.clientSecret(), StandardCharsets.UTF_8);
        HttpResponse<String> response = send(HttpRequest.newBuilder(uri("/realms/master/protocol/openid-connect/token"))
                .header("Content-Type", "application/x-www-form-urlencoded")
                .POST(HttpRequest.BodyPublishers.ofString(body)));
        if (response.statusCode() != 200) {
            throw new ServiceUnavailableException(
                    "Keycloak refused the administration client of the kernel (HTTP " + response.statusCode() + ").");
        }
        try {
            return json.readTree(response.body()).path("access_token").asText();
        } catch (IOException _) {
            throw new ServiceUnavailableException("Keycloak answered with an unreadable token.");
        }
    }

    private URI uri(String path) {
        URI base = config.keycloakInternalUrl()
                .or(config::keycloakUrl)
                .orElseThrow(() -> new ServiceUnavailableException("No Keycloak URL is set."));
        String prefix = base.toString().endsWith("/")
                ? base.toString().substring(0, base.toString().length() - 1)
                : base.toString();
        return URI.create(prefix + path);
    }

    private HttpResponse<String> send(HttpRequest.Builder request) {
        try {
            return http.send(request.timeout(TIMEOUT).build(), HttpResponse.BodyHandlers.ofString());
        } catch (IOException e) {
            throw new ServiceUnavailableException("Keycloak cannot be reached: " + e.getMessage());
        } catch (InterruptedException _) {
            Thread.currentThread().interrupt();
            throw new ServiceUnavailableException("Interrupted while calling Keycloak.");
        }
    }
}
