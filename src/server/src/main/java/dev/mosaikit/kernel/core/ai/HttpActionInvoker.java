// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.account.SessionResource;
import dev.mosaikit.kernel.core.identity.OrganizationAccess;
import io.quarkus.runtime.LaunchMode;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import org.eclipse.microprofile.config.inject.ConfigProperty;

/**
 * Calls the backend APIs of plugins over HTTP on the loopback interface of the kernel itself, so
 * that each call goes through authentication, the organization of the request, the plugin guard
 * and the permission checks of the plugin, exactly like a call of the web UI.
 */
@ApplicationScoped
public class HttpActionInvoker implements ActionInvoker {

    static final Duration TIMEOUT = Duration.ofSeconds(30);

    private static final String LOOPBACK_SCHEME = "http";

    private static final List<String> ANY_ADDRESS = List.of("0.0.0.0", "::", "[::]");

    private final ObjectMapper json;
    private final URI base;
    private final HttpClient http =
            HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();

    @Inject
    public HttpActionInvoker(
            ObjectMapper json,
            @ConfigProperty(name = "quarkus.http.host", defaultValue = "0.0.0.0") String host,
            @ConfigProperty(name = "quarkus.http.port", defaultValue = "8080") int port,
            @ConfigProperty(name = "quarkus.http.test-port", defaultValue = "8081") int testPort) {
        this(json, base(host, LaunchMode.current() == LaunchMode.TEST ? testPort : port));
    }

    HttpActionInvoker(ObjectMapper json, URI base) {
        this.json = json;
        this.base = base;
    }

    /** Where the kernel listens, as seen from the kernel. */
    static URI base(String host, int port) {
        String loopback = ANY_ADDRESS.contains(host) ? "localhost" : host;
        String authority = loopback.contains(":") && !loopback.startsWith("[") ? "[" + loopback + "]" : loopback;
        // Plain HTTP on purpose: the kernel calls itself on its own address, never over a network
        // it does not control; TLS, when used, ends at the reverse proxy in front of it.
        return URI.create(LOOPBACK_SCHEME + "://" + authority + ":" + port);
    }

    @Override
    public PluginResponse invoke(PluginCall call, Caller caller) {
        HttpRequest.Builder request = HttpRequest.newBuilder(base.resolve(call.target()))
                .timeout(TIMEOUT)
                .header("Accept", "application/json")
                .header(OrganizationAccess.HEADER, caller.organizationSlug());
        if (caller.authorization() != null) {
            request.header("Authorization", caller.authorization());
        } else if (caller.session() != null) {
            request.header("Cookie", SessionResource.COOKIE + "=" + caller.session());
        }
        if (call.body() == null) {
            request.method(call.method(), HttpRequest.BodyPublishers.noBody());
        } else {
            request.header("Content-Type", "application/json")
                    .method(call.method(), HttpRequest.BodyPublishers.ofString(write(call.body())));
        }
        try {
            HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
            String type = response.headers().firstValue("Content-Type").orElse("");
            return new PluginResponse(response.statusCode(), read(response.body(), type));
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot call " + call.path(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new UncheckedIOException("Interrupted while calling " + call.path(), new IOException(e));
        }
    }

    private String write(Object body) {
        try {
            return json.writeValueAsString(body);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("The arguments cannot be written as JSON", e);
        }
    }

    private Object read(String body, String type) {
        if (body == null || body.isBlank()) {
            return null;
        }
        if (!type.contains("json")) {
            return body;
        }
        try {
            return json.readValue(body, Object.class);
        } catch (JsonProcessingException _) {
            return body;
        }
    }
}
