// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The call of a tool to the backend of an extension, against a small HTTP server. */
@Tag("MK-015")
class HttpActionInvokerTest {

    private static final Caller ADA = new Caller("ada@example.org", UUID.randomUUID(), "acme", "Basic YWRh");

    private record Received(String method, String target, String authorization, String organization, String body) {}

    private final List<Received> received = new CopyOnWriteArrayList<>();
    private final List<String> cookies = new CopyOnWriteArrayList<>();
    private HttpServer server;
    private HttpActionInvoker invoker;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext(
                "/api/v1/ext/notes/json", exchange -> answer(exchange, 201, "application/json", "{\"id\":7}"));
        server.createContext("/api/v1/ext/notes/text", exchange -> answer(exchange, 200, "text/plain", "plain"));
        server.createContext(
                "/api/v1/ext/notes/broken", exchange -> answer(exchange, 500, "application/json", "{oops"));
        server.createContext("/api/v1/ext/notes/empty", exchange -> answer(exchange, 204, "application/json", ""));
        server.start();
        invoker = new HttpActionInvoker(
                new ObjectMapper(),
                URI.create("http://localhost:" + server.getAddress().getPort()));
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private void answer(HttpExchange exchange, int status, String type, String body) throws IOException {
        cookies.add(String.valueOf(exchange.getRequestHeaders().getFirst("Cookie")));
        received.add(new Received(
                exchange.getRequestMethod(),
                exchange.getRequestURI().toString(),
                exchange.getRequestHeaders().getFirst("Authorization"),
                exchange.getRequestHeaders().getFirst("X-Mosaikit-Organization"),
                new String(exchange.getRequestBody().readAllBytes(), UTF_8)));
        byte[] bytes = body.getBytes(UTF_8);
        exchange.getResponseHeaders().add("Content-Type", type);
        exchange.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
        if (bytes.length > 0) {
            exchange.getResponseBody().write(bytes);
        }
        exchange.close();
    }

    @Test
    void sendsTheCallWithTheCredentialsAndTheOrganizationOfThePerson() {
        ExtensionResponse response = invoker.invoke(
                new ExtensionCall("POST", "/api/v1/ext/notes/json", List.of(), Map.of("text", "hi")), ADA);

        assertThat(response).isEqualTo(new ExtensionResponse(201, Map.of("id", 7)));
        assertThat(response.succeeded()).isTrue();
        assertThat(received)
                .singleElement()
                .isEqualTo(new Received("POST", "/api/v1/ext/notes/json", "Basic YWRh", "acme", "{\"text\":\"hi\"}"));
    }

    @Test
    void sendsTheSessionOfTheShellWhenTheRequestHadNoAuthorization() {
        Caller shell = new Caller("ada@example.org", UUID.randomUUID(), "acme", null, "s3ss10n");

        invoker.invoke(new ExtensionCall("POST", "/api/v1/ext/notes/json", List.of(), Map.of("text", "hi")), shell);

        assertThat(received).singleElement().extracting(Received::authorization).isNull();
        assertThat(cookies).containsExactly("mosaikit-session=s3ss10n");
    }

    @Test
    void readsTextEmptyAndBrokenAnswers() {
        Caller anonymous = new Caller("bea", UUID.randomUUID(), "globex", null);

        assertThat(invoker.invoke(
                        new ExtensionCall("GET", "/api/v1/ext/notes/text", List.of(Map.entry("q", "a b")), null),
                        anonymous))
                .isEqualTo(new ExtensionResponse(200, "plain"));
        assertThat(invoker.invoke(new ExtensionCall("DELETE", "/api/v1/ext/notes/empty", List.of(), null), anonymous))
                .isEqualTo(new ExtensionResponse(204, null));
        ExtensionResponse broken =
                invoker.invoke(new ExtensionCall("GET", "/api/v1/ext/notes/broken", List.of(), null), ADA);
        assertThat(broken).isEqualTo(new ExtensionResponse(500, "{oops"));
        assertThat(broken.succeeded()).isFalse();
        assertThat(received.getFirst().target()).isEqualTo("/api/v1/ext/notes/text?q=a%20b");
        assertThat(received.getFirst().authorization()).isNull();
    }

    @Test
    void reportsAExtensionThatCannotBeReached() {
        server.stop(0);
        ExtensionCall call = new ExtensionCall("GET", "/api/v1/ext/notes/json", List.of(), null);

        assertThatThrownBy(() -> invoker.invoke(call, ADA))
                .isInstanceOf(UncheckedIOException.class)
                .hasMessageContaining("/api/v1/ext/notes/json");
    }

    @Test
    void refusesArgumentsThatAreNotJson() {
        ExtensionCall call =
                new ExtensionCall("POST", "/api/v1/ext/notes/json", List.of(), Map.of("self", new Object()));

        assertThatThrownBy(() -> invoker.invoke(call, ADA)).isInstanceOf(IllegalArgumentException.class);
    }
}
