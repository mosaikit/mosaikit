// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.core.live.LiveSocket.LivePages;
import io.quarkus.test.common.http.TestHTTPResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.vertx.core.Vertx;
import io.vertx.core.http.WebSocket;
import io.vertx.core.http.WebSocketConnectOptions;
import io.vertx.core.json.JsonObject;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.sql.DriverManager;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.eclipse.microprofile.config.Config;
import org.eclipse.microprofile.config.ConfigProvider;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The real-time channel of a page lives as long as the session it was opened with (MK-125): every way
 * of ending the session closes the socket within seconds, and no event reaches it afterwards, while
 * the pages of the other sessions go on.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-125")
class LiveSessionEndTest {

    private static final String SESSION = "mosaikit-session";
    private static final String PASSWORD = "a long enough password";

    @TestHTTPResource("/")
    URI base;

    private final Vertx vertx = Vertx.vertx();
    private String organization;
    private String ada;
    private String bea;

    @BeforeEach
    void people() {
        organization = TestData.unique("live-end");
        asAdmin()
                .body(Map.of("slug", organization, "name", "Acme live", "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        ada = register();
        bea = register();
    }

    @AfterEach
    void close() {
        vertx.close();
    }

    private String register() {
        String email = TestData.unique("live-end") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static String signIn(String person) {
        return given().formParam("username", person)
                .formParam("password", PASSWORD)
                .post("/api/v1/accounts/session")
                .then()
                .statusCode(200)
                .extract()
                .cookie(SESSION);
    }

    /** A page of the shell: its socket, the messages it received and the code it was closed with. */
    record Page(WebSocket socket, LinkedBlockingQueue<JsonObject> messages, CompletableFuture<Short> closed) {

        void subscribe() throws InterruptedException {
            socket.writeTextMessage(new JsonObject(Map.of("type", "subscribe", "topic", LiveTest.TOPIC)).encode());
            JsonObject answer = messages.poll(5, TimeUnit.SECONDS);
            assertThat(answer).as("an answer to the subscription").isNotNull();
            assertThat(answer.getString("type")).isEqualTo("subscribed");
        }

        /** The event of the item, waiting for it at most a few seconds. */
        JsonObject event() throws InterruptedException {
            JsonObject message = messages.poll(5, TimeUnit.SECONDS);
            assertThat(message).as("an event on the socket").isNotNull();
            return message;
        }
    }

    private Page connect(String header, String value) throws Exception {
        WebSocketConnectOptions options = new WebSocketConnectOptions()
                .setHost(base.getHost())
                .setPort(base.getPort())
                .setURI("/api/v1/live?organization=" + organization)
                .addHeader(header, value);
        LinkedBlockingQueue<JsonObject> messages = new LinkedBlockingQueue<>();
        CompletableFuture<Short> closed = new CompletableFuture<>();
        WebSocket socket = vertx.createWebSocketClient()
                .connect(options)
                .toCompletionStage()
                .toCompletableFuture()
                .get(10, TimeUnit.SECONDS);
        socket.textMessageHandler(text -> messages.add(new JsonObject(text)));
        socket.closeHandler(ignored -> closed.complete(socket.closeStatusCode()));
        Page page = new Page(socket, messages, closed);
        page.subscribe();
        return page;
    }

    private Page withCookie(String cookie) throws Exception {
        return connect("Cookie", SESSION + "=" + cookie);
    }

    private Page withPassword(String person) throws Exception {
        String credentials =
                Base64.getEncoder().encodeToString((person + ":" + PASSWORD).getBytes(StandardCharsets.UTF_8));
        return connect("Authorization", "Basic " + credentials);
    }

    /** Bea adds an item: an event for every page of the organization subscribed to the collection. */
    private void anItemIsAdded() {
        as(bea, PASSWORD)
                .header("X-Mosaikit-Organization", organization)
                .body(Map.of("title", "Paint the fence"))
                .post("/api/v1/data/" + LiveTest.EXTENSION + "/items")
                .then()
                .statusCode(201);
    }

    /** The page was closed because its session ended, and receives nothing afterwards. */
    private void assertEnded(Page page, int seconds) throws Exception {
        assertThat(page.closed().get(seconds, TimeUnit.SECONDS))
                .as("the close code")
                .isEqualTo((short) LivePages.SESSION_ENDED);
        anItemIsAdded();
        assertThat(page.messages().poll(1, TimeUnit.SECONDS))
                .as("a message after the end")
                .isNull();
    }

    @Test
    void signOutClosesThePageOfTheSessionAndNotTheOthers() throws Exception {
        String first = signIn(ada);
        String second = signIn(ada);
        Page ended = withCookie(first);
        Page going = withCookie(second);

        given().cookie(SESSION, first).delete("/api/v1/accounts/session").then().statusCode(204);

        assertEnded(ended, 3);
        assertThat(going.event().getString("type")).isEqualTo("event");
        assertThat(going.closed()).isNotDone();
    }

    @Test
    void endingASessionInTheSettingsClosesItsPage() throws Exception {
        String phone = signIn(ada);
        String laptop = signIn(ada);
        Page onPhone = withCookie(phone);
        Page onLaptop = withCookie(laptop);
        List<Map<String, Object>> sessions = given().cookie(SESSION, laptop)
                .get("/api/v1/accounts/me/sessions")
                .then()
                .statusCode(200)
                .extract()
                .path("$");
        String phoneSession = sessions.stream()
                .filter(session -> !Boolean.TRUE.equals(session.get("current")))
                .map(session -> (String) session.get("id"))
                .findFirst()
                .orElseThrow();

        given().cookie(SESSION, laptop)
                .delete("/api/v1/accounts/me/sessions/{id}", phoneSession)
                .then()
                .statusCode(204);

        assertEnded(onPhone, 3);
        assertThat(onLaptop.event().getString("type")).isEqualTo("event");
    }

    @Test
    void suspensionClosesEveryPageOfTheAccount() throws Exception {
        Page withSession = withCookie(signIn(ada));
        Page withPassword = withPassword(ada);
        Page ofBea = withCookie(signIn(bea));
        try {
            asAdmin()
                    .put("/api/v1/platform/accounts/{email}/suspension", ada)
                    .then()
                    .statusCode(200);

            assertEnded(withSession, 3);
            assertThat(withPassword.closed().get(3, TimeUnit.SECONDS)).isEqualTo((short) LivePages.SESSION_ENDED);
            assertThat(withPassword.messages()).isEmpty();
            assertThat(ofBea.event().getString("type")).isEqualTo("event");
        } finally {
            asAdmin().delete("/api/v1/platform/accounts/{email}/suspension", ada);
        }
    }

    @Test
    void removalFromTheOrganizationClosesThePagesInIt() throws Exception {
        Page page = withCookie(signIn(ada));

        asAdmin()
                .delete("/api/v1/organizations/{slug}/members/{email}", organization, ada)
                .then()
                .statusCode(204);

        assertEnded(page, 3);
    }

    @Test
    void closesThePageOfASessionEndedByAnotherKernel() throws Exception {
        String cookie = signIn(ada);
        Page page = withCookie(cookie);
        String session = given().cookie(SESSION, cookie)
                .get("/api/v1/accounts/me/sessions")
                .then()
                .statusCode(200)
                .extract()
                .path("[0].id");

        // Another kernel of the installation ends it: only the database knows. The kernel writes the
        // sessions as the owner of the tables.
        Config config = ConfigProvider.getConfig();
        try (var connection = DriverManager.getConnection(
                        config.getValue("quarkus.datasource.jdbc.url", String.class),
                        config.getValue("quarkus.datasource.username", String.class),
                        config.getValue("quarkus.datasource.password", String.class));
                var statement = connection.prepareStatement(
                        "update mk_kernel.account_session set ended_at = now() where id = ?")) {
            statement.setObject(1, UUID.fromString(session));
            assertThat(statement.executeUpdate()).isEqualTo(1);
        }

        assertEnded(page, 10);
    }
}
