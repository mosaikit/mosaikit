// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.error.ProblemDetail;
import io.quarkus.oidc.OIDCException;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import org.jboss.logging.Logger;

/**
 * Answers {@code 503 Service Unavailable} when a bearer token cannot be verified because the
 * realm of its organization is unreachable, instead of a generic server error. The UI then
 * offers to sign in with a local password, which never depends on Keycloak (MK-012).
 */
@ApplicationScoped
public class IdentityProviderFailures {

    private static final Logger LOG = Logger.getLogger(IdentityProviderFailures.class);
    private static final String RETRY_AFTER_SECONDS = "30";

    private final ObjectMapper json;

    public IdentityProviderFailures(ObjectMapper json) {
        this.json = json;
    }

    void register(@Observes Router router) {
        router.route().order(Integer.MIN_VALUE).failureHandler(this::handle);
    }

    private void handle(RoutingContext context) {
        if (!(context.failure() instanceof OIDCException) || context.response().headWritten()) {
            context.next();
            return;
        }
        LOG.warnf(
                "Identity provider unavailable for %s: %s",
                context.normalizedPath(), context.failure().getMessage());
        var problem = new ProblemDetail(
                "about:blank",
                "Service Unavailable",
                503,
                "The identity provider of the organization cannot be reached. Try again later or sign in"
                        + " with a local password.",
                null);
        try {
            context.response()
                    .setStatusCode(503)
                    .putHeader("Content-Type", ProblemDetail.MEDIA_TYPE)
                    .putHeader("Retry-After", RETRY_AFTER_SECONDS)
                    .end(json.writeValueAsString(problem));
        } catch (JsonProcessingException _) {
            context.response().setStatusCode(503).end();
        }
    }
}
