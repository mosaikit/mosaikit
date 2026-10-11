// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.io.UncheckedIOException;
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

/** The client of an OpenAI-compatible chat completions API, against a small HTTP server. */
@Tag("MK-024")
class ChatCompletionsModelTest {

    private final ObjectMapper json = new ObjectMapper();
    private final List<String> received = new CopyOnWriteArrayList<>();
    private volatile int status = 200;
    private volatile String answer = "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"Ciao\"}}]}";
    private HttpServer server;
    private URI base;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress(InetAddress.getLoopbackAddress(), 0), 0);
        server.createContext("/v1/chat/completions", exchange -> {
            received.add(exchange.getRequestHeaders().getFirst("Authorization") + " "
                    + new String(exchange.getRequestBody().readAllBytes(), UTF_8));
            byte[] body = answer.getBytes(UTF_8);
            exchange.sendResponseHeaders(status, body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        base = URI.create("http://localhost:" + server.getAddress().getPort() + "/v1");
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private ChatCompletionsModel model(Optional<String> key) {
        return new ChatCompletionsModel(json, Optional.of(base), "llama3.1", key, Duration.ofSeconds(5));
    }

    @Test
    void sendsTheRequestWithTheModelAndTheKey() {
        var request = json.createObjectNode();
        request.putArray("messages").addObject().put("role", "user").put("content", "Ciao");

        assertThat(model(Optional.of("secret"))
                        .complete(request)
                        .path("content")
                        .asText())
                .isEqualTo("Ciao");
        assertThat(received)
                .singleElement()
                .satisfies(line -> assertThat(line)
                        .startsWith("Bearer secret ")
                        .contains("\"model\":\"llama3.1\"", "\"content\":\"Ciao\""));
        assertThat(model(Optional.of(" ")).model()).contains("llama3.1");
    }

    @Test
    void reportsErrorsOfTheModel() {
        ChatCompletionsModel model = model(Optional.empty());
        ObjectNode request = json.createObjectNode();
        status = 500;
        answer = "overloaded";
        assertThatThrownBy(() -> model.complete(request))
                .isInstanceOf(UncheckedIOException.class)
                .hasMessageContaining("500");
        status = 200;
        answer = "{\"choices\":[]}";
        assertThatThrownBy(() -> model.complete(request)).hasMessageContaining("without a message");
        answer = "not json";
        assertThatThrownBy(() -> model.complete(request)).isInstanceOf(UncheckedIOException.class);
        server.stop(0);
        // A refused connection says where the model was expected, never "null".
        assertThatThrownBy(() -> model.complete(request))
                .hasMessageContaining("Cannot reach the model: ")
                .hasMessageNotContaining("null");
    }

    @Test
    void hasNoModelWithoutAUrl() {
        ChatCompletionsModel none =
                new ChatCompletionsModel(json, Optional.empty(), "llama3.1", Optional.empty(), Duration.ofSeconds(1));

        ObjectNode request = json.createObjectNode();

        assertThat(none.model()).isEmpty();
        assertThatThrownBy(() -> none.complete(request)).isInstanceOf(IllegalStateException.class);
    }
}
