// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web;

import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;

/**
 * Keeps the browser from asking for a password when a session of the shell ends: a 401 answered to
 * the shell (header {@code X-Mosaikit-Client: shell}) carries no {@code WWW-Authenticate: Basic},
 * which would open the sign-in dialog of the browser; the shell shows its own sign-in instead. Other
 * clients get the challenge as before.
 */
@ApplicationScoped
public class ShellChallenge {

    /** Header with which the shell marks its requests. */
    public static final String CLIENT_HEADER = "X-Mosaikit-Client";

    private static final String WWW_AUTHENTICATE = "WWW-Authenticate";

    /** Before authentication (order -200), which may end the request with its challenge. */
    static final int ORDER = -300;

    void register(@Observes Router router) {
        router.route("/api/*").order(ORDER).handler(ShellChallenge::withoutBasicChallenge);
    }

    static void withoutBasicChallenge(RoutingContext context) {
        if ("shell".equals(context.request().getHeader(CLIENT_HEADER))) {
            context.addHeadersEndHandler(ignored -> {
                if (context.response().getStatusCode() == 401) {
                    context.response().headers().remove(WWW_AUTHENTICATE);
                }
            });
        }
        context.next();
    }
}
