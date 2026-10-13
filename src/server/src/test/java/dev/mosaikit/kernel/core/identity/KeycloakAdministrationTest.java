// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import java.io.IOException;
import java.lang.reflect.Proxy;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The calls to the administration API of Keycloak, against a stand-in server that answers as
 * Keycloak would. The real Keycloak is exercised by RealmProvisioningTest.
 */
@Tag("MK-018")
class KeycloakAdministrationTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private HttpServer server;
    private final List<String> requests = new CopyOnWriteArrayList<>();
    private volatile int tokenStatus = 200;
    private volatile String tokenBody = "{\"access_token\":\"t0k3n\"}";
    private volatile int realmStatus = 201;

    @BeforeEach
    void startKeycloak() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/realms/master/protocol/openid-connect/token", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), UTF_8);
            requests.add("token " + body);
            answer(exchange, tokenStatus, tokenBody);
        });
        server.createContext("/admin/realms", exchange -> {
            requests.add(
                    exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath() + " "
                            + exchange.getRequestHeaders().getFirst("Authorization"));
            answer(exchange, "DELETE".equals(exchange.getRequestMethod()) ? 204 : realmStatus, "");
        });
        server.start();
    }

    @AfterEach
    void stopKeycloak() {
        server.stop(0);
    }

    @Test
    void createsARealmWithTheTokenOfTheServiceAccount() {
        administration(url() + "/").createRealm(realm("acme"));

        assertThat(requests)
                .containsExactly(
                        "token grant_type=client_credentials&client_id=mosaikit-admin&client_secret=s%26cret",
                        "POST /admin/realms Bearer t0k3n");
    }

    @Test
    void reportsAnExistingRealmAsAConflict() {
        realmStatus = 409;
        var administration = administration(url());
        var acme = realm("acme");

        assertThatThrownBy(() -> administration.createRealm(acme))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("'acme'");
    }

    @Test
    void reportsARefusedRealmAsUnavailable() {
        realmStatus = 500;
        var administration = administration(url());
        var acme = realm("acme");

        assertThatThrownBy(() -> administration.createRealm(acme))
                .isInstanceOf(ServiceUnavailableException.class)
                .hasMessageContaining("HTTP 500");
    }

    @Test
    void reportsARefusedOrUnreadableToken() {
        var administration = administration(url());
        var acme = realm("acme");

        tokenStatus = 401;
        assertThatThrownBy(() -> administration.createRealm(acme))
                .isInstanceOf(ServiceUnavailableException.class)
                .hasMessageContaining("HTTP 401");

        tokenStatus = 200;
        tokenBody = "not json";
        assertThatThrownBy(() -> administration.createRealm(acme))
                .isInstanceOf(ServiceUnavailableException.class)
                .hasMessageContaining("unreadable token");
    }

    @Test
    void deletesARealmAndOnlyLogsWhenKeycloakIsGone() {
        var administration = administration(url());

        administration.deleteRealm("acme corp");
        assertThat(requests).last().isEqualTo("DELETE /admin/realms/acme+corp Bearer t0k3n");

        server.stop(0);
        assertThatNoException().isThrownBy(() -> administration.deleteRealm("acme"));
    }

    @Test
    void needsAUrlAndAServiceAccount() {
        var withoutUrl = new KeycloakAdministration(config(null, Optional.empty()), JSON);
        var withoutAccount = new KeycloakAdministration(config(url(), Optional.empty()), JSON);
        var acme = realm("acme");

        assertThat(withoutUrl.available()).isFalse();
        assertThat(withoutAccount.available()).isFalse();
        assertThat(administration(url()).available()).isTrue();
        assertThatThrownBy(() -> withoutAccount.createRealm(acme))
                .isInstanceOf(ServiceUnavailableException.class)
                .hasMessageContaining("administration client is not set");
        assertThatThrownBy(() -> withoutUrl.createRealm(acme))
                .isInstanceOf(ServiceUnavailableException.class)
                .hasMessageContaining("No Keycloak URL");
    }

    private KeycloakAdministration administration(String url) {
        return new KeycloakAdministration(config(url, Optional.of(admin())), JSON);
    }

    private String url() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private static ObjectNode realm(String name) {
        return JSON.createObjectNode().put("realm", name);
    }

    private static void answer(HttpExchange exchange, int status, String body) throws IOException {
        byte[] bytes = body.getBytes(UTF_8);
        exchange.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
        if (bytes.length > 0) {
            exchange.getResponseBody().write(bytes);
        }
        exchange.close();
    }

    private static KernelConfig.Identity.Admin admin() {
        return new KernelConfig.Identity.Admin() {
            @Override
            public String clientId() {
                return "mosaikit-admin";
            }

            @Override
            public String clientSecret() {
                return "s&cret";
            }
        };
    }

    private static KernelConfig config(String url, Optional<KernelConfig.Identity.Admin> admin) {
        KernelConfig.Identity identity = new KernelConfig.Identity() {
            @Override
            public Optional<URI> keycloakUrl() {
                return Optional.ofNullable(url).map(URI::create);
            }

            @Override
            public Optional<URI> keycloakInternalUrl() {
                return Optional.empty();
            }

            @Override
            public Optional<Admin> admin() {
                return admin;
            }

            @Override
            public String clientId() {
                return "mosaikit";
            }

            @Override
            public Optional<String> domain() {
                return Optional.empty();
            }

            @Override
            public Duration cacheTtl() {
                return Duration.ofSeconds(30);
            }
        };
        return (KernelConfig) Proxy.newProxyInstance(
                KernelConfig.class.getClassLoader(), new Class<?>[] {KernelConfig.class}, (proxy, method, args) -> {
                    if (method.getName().equals("identity")) {
                        return identity;
                    }
                    throw new UnsupportedOperationException(method.getName());
                });
    }
}
