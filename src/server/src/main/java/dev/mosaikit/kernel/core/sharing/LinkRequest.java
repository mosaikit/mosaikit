// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import io.quarkus.arc.Arc;
import io.quarkus.arc.Unremovable;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.vertx.http.runtime.CurrentVertxRequest;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.RequestScoped;
import java.util.Optional;

/**
 * The link a request was opened with (MK-055): the secret in the {@value #HEADER} header and its
 * password, if any, in {@value #PASSWORD_HEADER}. {@code Sharing} answers for it when the request
 * names no person, or alongside the person when the link is of the organization of the request. The
 * link is resolved, and its use written in the audit log, once per request, when first asked.
 */
@RequestScoped
@Unremovable
public class LinkRequest {

    /** Header with the secret of the link the request was opened with. */
    public static final String HEADER = "X-Mosaikit-Link";

    /** Header with the password of that link. */
    public static final String PASSWORD_HEADER = "X-Mosaikit-Link-Password";

    /**
     * Data of the routing context: the link that {@link LinkRequestPolicy} already opened for a
     * request without an account to the API of an extension, so that it is resolved and audited once.
     */
    public static final String OPENED = "mosaikit.link.opened";

    private final SharedLinks links;
    private final CurrentVertxRequest request;
    private final SecurityIdentity identity;
    private Optional<SharedLinks.Opened> opened = Optional.empty();
    private boolean resolved;

    public LinkRequest(SharedLinks links, CurrentVertxRequest request, SecurityIdentity identity) {
        this.links = links;
        this.request = request;
        this.identity = identity;
    }

    /** The link of the request, when it has one that works. */
    public Optional<SharedLinks.Opened> opened() {
        if (!resolved) {
            opened = resolve();
            resolved = true;
        }
        return opened;
    }

    private Optional<SharedLinks.Opened> resolve() {
        RoutingContext routing = request.getCurrent();
        if (routing != null && routing.get(OPENED) instanceof SharedLinks.Opened already) {
            return Optional.of(already);
        }
        String secret = routing == null ? null : routing.request().getHeader(HEADER);
        if (secret == null || secret.isBlank()) {
            return Optional.empty();
        }
        String password = routing.request().getHeader(PASSWORD_HEADER);
        String actor = identity == null || identity.isAnonymous()
                ? "anonymous"
                : identity.getPrincipal().getName();
        try {
            return Optional.of(links.open(secret, password, actor));
        } catch (SharedLinks.RefusedException _) {
            return Optional.empty();
        }
    }

    /** The link of the current request, when there is a request and it has a link that works. */
    static Optional<SharedLinks.Opened> current() {
        var container = Arc.container();
        if (container == null || !container.requestContext().isActive()) {
            return Optional.empty();
        }
        return container.instance(LinkRequest.class).get().opened();
    }
}
