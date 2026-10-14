// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.KeycloakTestResource.ACME;
import static dev.mosaikit.kernel.app.KeycloakTestResource.email;
import static dev.mosaikit.kernel.app.KeycloakTestResource.token;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;

import dev.mosaikit.kernel.core.live.LiveSocket.LivePages;
import io.quarkus.test.common.WithTestResource;
import io.quarkus.test.common.http.TestHTTPResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.specification.RequestSpecification;
import io.vertx.core.Vertx;
import io.vertx.core.http.WebSocket;
import io.vertx.core.http.WebSocketConnectOptions;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The kernel side of the sessions of a realm (MK-125): signing out, ending the session in the settings
 * or a suspension refuse the tokens of the realm session at once, before they expire.
 */
@QuarkusTest
@WithTestResource(KeycloakTestResource.class)
@Tag("keycloak")
@Tag("MK-125")
class FederatedSessionTest {

    @TestHTTPResource("/")
    URI base;

    @BeforeEach
    void createOrganization() {
        asAdmin()
                .body(Map.of("slug", ACME, "name", ACME, "selfRegistration", true))
                .post("/api/v1/organizations");
        asAdmin()
                .body(Map.of("realm", ACME, "emailDomains", List.of(ACME + ".test")))
                .put("/api/v1/organizations/{slug}/identity", ACME)
                .then()
                .statusCode(200);
    }

    private static RequestSpecification bearer(String token) {
        return given().auth().oauth2(token);
    }

    @Test
    void signOutRefusesTheTokensOfTheRealmSession() {
        String token = token(ACME, "alice");
        bearer(token).get("/api/v1/accounts/me").then().statusCode(200);
        bearer(token)
                .get("/api/v1/accounts/me/sessions")
                .then()
                .statusCode(200)
                .body("find { it.current }.kind", equalTo("realm"));

        bearer(token).delete("/api/v1/accounts/session").then().statusCode(204);

        // The token has not expired, but its session ended on the kernel.
        bearer(token).get("/api/v1/accounts/me").then().statusCode(401);
        // A new sign-in through the realm is a new session.
        bearer(token(ACME, "alice")).get("/api/v1/accounts/me").then().statusCode(200);
    }

    @Test
    void suspensionRefusesEveryTokenOfTheAccount() {
        String bob = email("bob", ACME);
        String token = token(ACME, "bob");
        bearer(token).get("/api/v1/accounts/me").then().statusCode(200);
        try {
            asAdmin()
                    .put("/api/v1/platform/accounts/{email}/suspension", bob)
                    .then()
                    .statusCode(200);

            bearer(token).get("/api/v1/accounts/me").then().statusCode(401);
            bearer(token(ACME, "bob")).get("/api/v1/accounts/me").then().statusCode(401);
            asAdmin().get("/api/v1/audit-events?limit=20").then().body("action", hasItem("account.suspended"));
        } finally {
            asAdmin()
                    .delete("/api/v1/platform/accounts/{email}/suspension", bob)
                    .then()
                    .statusCode(200);
        }
        bearer(token(ACME, "bob")).get("/api/v1/accounts/me").then().statusCode(200);
    }

    @Test
    void signOutClosesTheLiveChannelOfTheRealmSession() throws Exception {
        String token = token(ACME, "alice");
        bearer(token).get("/api/v1/accounts/me").then().statusCode(200);
        Vertx vertx = Vertx.vertx();
        try {
            WebSocket socket = vertx.createWebSocketClient()
                    .connect(new WebSocketConnectOptions()
                            .setHost(base.getHost())
                            .setPort(base.getPort())
                            .setURI("/api/v1/live?organization=" + ACME)
                            .addHeader("Authorization", "Bearer " + token))
                    .toCompletionStage()
                    .toCompletableFuture()
                    .get(10, TimeUnit.SECONDS);
            CompletableFuture<Short> closed = new CompletableFuture<>();
            socket.closeHandler(ignored -> closed.complete(socket.closeStatusCode()));

            bearer(token).delete("/api/v1/accounts/session").then().statusCode(204);

            assertThat(closed.get(3, TimeUnit.SECONDS)).isEqualTo((short) LivePages.SESSION_ENDED);
        } finally {
            vertx.close();
        }
    }
}
