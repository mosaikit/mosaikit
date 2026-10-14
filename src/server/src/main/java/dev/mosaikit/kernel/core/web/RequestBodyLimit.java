// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web;

import dev.mosaikit.kernel.core.error.ProblemDetail;
import io.quarkus.runtime.configuration.MemorySize;
import io.vertx.core.http.HttpHeaders;
import io.vertx.core.json.JsonObject;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import java.util.Optional;
import org.eclipse.microprofile.config.Config;

/**
 * Refuses a request whose declared body is larger than {@code quarkus.http.limits.max-body-size} with
 * 413 as a problem detail that names the limit (MK-010). Quarkus refuses it too, a step later, but with
 * an empty body, which leaves an installation without a gateway in front of it with no reason to show.
 * As Quarkus does, the body is not read and the connection is closed after the answer.
 */
@ApplicationScoped
public class RequestBodyLimit {

    static final String SETTING = "quarkus.http.limits.max-body-size";

    /** Before the check of Quarkus ({@code RouteConstants.ROUTE_ORDER_UPLOAD_LIMIT}, -2). */
    static final int ORDER = -3;

    private final Optional<Limit> limit;

    public RequestBodyLimit(Config config) {
        this.limit = config.getOptionalValue(SETTING, MemorySize.class)
                .map(size -> new Limit(
                        size.asLongValue(), config.getConfigValue(SETTING).getValue()));
    }

    void register(@Observes Router router) {
        limit.ifPresent(max -> router.route().order(ORDER).handler(context -> check(context, max)));
    }

    private static void check(RoutingContext context, Limit max) {
        String declared = context.request().getHeader(HttpHeaders.CONTENT_LENGTH);
        if (declared != null && isOver(declared, max.bytes())) {
            context.response()
                    .setStatusCode(413)
                    .putHeader(HttpHeaders.CONTENT_TYPE, ProblemDetail.MEDIA_TYPE)
                    .putHeader(HttpHeaders.CONNECTION, "close")
                    .endHandler(ended -> context.request().connection().close())
                    .end(problem(max).encode());
            return;
        }
        context.next();
    }

    private static boolean isOver(String declared, long bytes) {
        try {
            return Long.parseLong(declared.trim()) > bytes;
        } catch (NumberFormatException notANumber) {
            return false; // Vert.x refuses a malformed Content-Length itself
        }
    }

    static JsonObject problem(Limit max) {
        return new JsonObject()
                .put("type", "about:blank")
                .put("title", "Content too large")
                .put("status", 413)
                .put(
                        "detail",
                        "The body of a request has at most " + max.text() + " (" + max.bytes()
                                + " bytes), the setting " + SETTING + " of this installation. Send a smaller"
                                + " body, or ask the administrator to raise the setting.");
    }

    /** The limit in bytes, and as the installation wrote it. */
    record Limit(long bytes, String text) {
        Limit {
            text = text == null || text.isBlank() ? bytes + "B" : text.trim();
        }
    }
}
