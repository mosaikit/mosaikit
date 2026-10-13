// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import dev.mosaikit.kernel.core.config.KernelConfig;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Optional;

/**
 * A model behind an OpenAI-compatible {@code /chat/completions} API: a local Ollama or vLLM, which
 * keeps the data of the organization on the premises, or a hosted service.
 */
@ApplicationScoped
public class ChatCompletionsModel implements LanguageModel {

    private final ObjectMapper json;
    private final Optional<URI> url;
    private final String model;
    private final Optional<String> apiKey;
    private final Duration timeout;
    private final HttpClient http =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();

    @Inject
    public ChatCompletionsModel(ObjectMapper json, KernelConfig config) {
        this(
                json,
                config.assistant().url(),
                config.assistant().model(),
                config.assistant().apiKey(),
                config.assistant().timeout());
    }

    ChatCompletionsModel(
            ObjectMapper json, Optional<URI> url, String model, Optional<String> apiKey, Duration timeout) {
        this.json = json;
        this.url = url;
        this.model = model;
        this.apiKey = apiKey.filter(key -> !key.isBlank());
        this.timeout = timeout;
    }

    @Override
    public Optional<String> model() {
        return url.map(ignored -> model);
    }

    @Override
    public JsonNode complete(ObjectNode request) {
        URI base = url.orElseThrow(() -> new IllegalStateException("No assistant is configured"));
        String root = base.toString().endsWith("/") ? base.toString() : base + "/";
        request.put("model", model);
        HttpRequest.Builder call = HttpRequest.newBuilder(URI.create(root).resolve("chat/completions"))
                .timeout(timeout)
                .header("Content-Type", "application/json");
        apiKey.ifPresent(key -> call.header("Authorization", "Bearer " + key));
        try {
            HttpResponse<String> response = http.send(
                    call.POST(HttpRequest.BodyPublishers.ofString(json.writeValueAsString(request)))
                            .build(),
                    HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                throw new UncheckedIOException(new IOException(
                        "The model answered " + response.statusCode() + ": " + abbreviate(response.body())));
            }
            JsonNode message =
                    json.readTree(response.body()).path("choices").path(0).path("message");
            if (message.isMissingNode()) {
                throw new UncheckedIOException(new IOException("The model answered without a message"));
            }
            return message;
        } catch (IOException e) {
            // A refused connection has no message: say where the model was expected instead.
            String reason = e.getMessage() == null || e.getMessage().isBlank()
                    ? "no answer at " + root + " (" + e.getClass().getSimpleName() + ")"
                    : e.getMessage();
            throw new UncheckedIOException("Cannot reach the model: " + reason, e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new UncheckedIOException(new IOException("Interrupted while waiting for the model", e));
        }
    }

    private static String abbreviate(String text) {
        return text.length() <= 300 ? text : text.substring(0, 300) + "…";
    }
}
