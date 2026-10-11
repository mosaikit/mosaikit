// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.quarkus.test.common.http.TestHTTPResource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.vertx.core.Vertx;
import io.vertx.core.http.WebSocket;
import io.vertx.core.http.WebSocketClient;
import io.vertx.core.http.WebSocketConnectOptions;
import io.vertx.core.json.JsonObject;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The real-time channel of the shell (MK-031). */
@QuarkusTest
@TestProfile(LiveTest.TodoPlugin.class)
@Tag("MK-031")
class LiveTest {

    static final Path PLUGINS = Path.of("target", "live-test", "plugins").toAbsolutePath();
    static final String PLUGIN = "dev.mosaikit.test.live";
    static final String TOPIC = "documents." + PLUGIN + ".items";
    static final String PASSWORD = "a long enough password";

    /** A plugin with a collection of documents. */
    public static class TodoPlugin implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            try {
                Path plugin = Files.createDirectories(PLUGINS.resolve("live").resolve("web"));
                Files.writeString(plugin.resolve("index.js"), "export default { activate() {} };\n");
                Files.writeString(plugin.getParent().resolve("manifest.yaml"), """
                        id: dev.mosaikit.test.live
                        version: 1.0.0
                        name: Live (test)
                        kind: [app]
                        platform: '>=0.1 <1'
                        frontend:
                          entry: web/index.js
                        data:
                          collections: [items]
                        """);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
            return Map.of("mosaikit.plugins.directory", PLUGINS.toString());
        }
    }

    @TestHTTPResource("/")
    URI base;

    private final Vertx vertx = Vertx.vertx();
    private String ada;
    private String bea;

    @BeforeEach
    void people() {
        for (String slug : new String[] {"live-acme", "live-globex"}) {
            asAdmin()
                    .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                    .post("/api/v1/organizations");
        }
        ada = register("live-acme");
        bea = register("live-globex");
    }

    @AfterEach
    void close() {
        vertx.close();
    }

    private static String register(String organization) {
        String email = unique("live") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    /** A page of the shell: its socket and the messages it received. */
    record Page(WebSocket socket, LinkedBlockingQueue<JsonObject> messages) {

        void send(Map<String, Object> message) {
            socket.writeTextMessage(new JsonObject(message).encode());
        }

        JsonObject next() throws InterruptedException {
            JsonObject message = messages.poll(5, TimeUnit.SECONDS);
            assertThat(message).as("a message on the socket").isNotNull();
            return message;
        }
    }

    private Page connect(String person, String organization) throws Exception {
        String credentials =
                Base64.getEncoder().encodeToString((person + ":" + PASSWORD).getBytes(StandardCharsets.UTF_8));
        WebSocketConnectOptions options = new WebSocketConnectOptions()
                .setHost(base.getHost())
                .setPort(base.getPort())
                .setURI("/api/v1/live?organization=" + organization)
                .addHeader("Authorization", "Basic " + credentials);
        WebSocketClient client = vertx.createWebSocketClient();
        LinkedBlockingQueue<JsonObject> messages = new LinkedBlockingQueue<>();
        WebSocket socket = client.connect(options)
                .toCompletionStage()
                .toCompletableFuture()
                .get(10, TimeUnit.SECONDS);
        socket.textMessageHandler(text -> messages.add(new JsonObject(text)));
        return new Page(socket, messages);
    }

    @Test
    void sendsTheChangesOfACollectionToThePagesOfTheOrganizationWithinASecond() throws Exception {
        Page acme = connect(ada, "live-acme");
        Page globex = connect(bea, "live-globex");
        for (Page page : new Page[] {acme, globex}) {
            page.send(Map.of("type", "subscribe", "topic", TOPIC));
            assertThat(page.next().getString("type")).isEqualTo("subscribed");
        }

        long sent = System.nanoTime();
        String id = as(ada, PASSWORD)
                .header("X-Mosaikit-Organization", "live-acme")
                .body(Map.of("title", "Paint the fence"))
                .post("/api/v1/data/" + PLUGIN + "/items")
                .then()
                .statusCode(201)
                .extract()
                .path("id");

        JsonObject event = acme.next();
        assertThat(Duration.ofNanos(System.nanoTime() - sent)).isLessThan(Duration.ofSeconds(1));
        assertThat(event.getString("type")).isEqualTo("event");
        assertThat(event.getString("topic")).isEqualTo(TOPIC);
        assertThat(event.getJsonObject("data").getString("id")).isEqualTo(id);
        assertThat(event.getJsonObject("data").getString("action")).isEqualTo("created");
        // The pages of another organization receive nothing.
        assertThat(globex.messages().poll(500, TimeUnit.MILLISECONDS)).isNull();
    }

    @Test
    void refusesTopicsThatThePersonMayNotRead() throws Exception {
        Page page = connect(ada, "live-acme");
        for (String topic :
                new String[] {"documents." + PLUGIN + ".secrets", "documents.dev.none.items", "admin.everything"}) {
            page.send(Map.of("type", "subscribe", "topic", topic));
            JsonObject answer = page.next();
            assertThat(answer.getString("type")).as(topic).isEqualTo("refused");
            assertThat(answer.getString("topic")).isEqualTo(topic);
        }
        page.send(Map.of("type", "subscribe", "topic", "notifications"));
        assertThat(page.next().getString("type")).isEqualTo("subscribed");
    }

    @Test
    void refusesPeopleWhoAreNotSignedIn() {
        WebSocketConnectOptions options = new WebSocketConnectOptions()
                .setHost(base.getHost())
                .setPort(base.getPort())
                .setURI("/api/v1/live");
        assertThatThrownBy(() -> vertx.createWebSocketClient()
                        .connect(options)
                        .toCompletionStage()
                        .toCompletableFuture()
                        .get(10, TimeUnit.SECONDS))
                .hasMessageContaining("401");
    }
}
