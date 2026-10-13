// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.identity.OrganizationAccess;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.vertx.http.runtime.security.QuarkusHttpUser;
import io.vertx.core.http.HttpHeaders;
import io.vertx.core.http.HttpMethod;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * What a request made with a personal access key (MK-060) may do, for the APIs of the kernel and of
 * extensions alike:
 *
 * <ul>
 *   <li>a key created without the write switch passes only {@code GET}, {@code HEAD} and {@code
 *       OPTIONS}: every other method is refused with 403;
 *   <li>no key signs in to the shell, opens or ends sessions, or manages keys: those need a person
 *       signed in, so that a stolen key cannot give itself a longer life or a session.
 * </ul>
 */
@ApplicationScoped
public class AccessKeyGuard {

    /** After authentication (-200) and the permission check (-100), before the extension APIs (-50). */
    static final int ORDER = -60;

    static final Set<HttpMethod> READ = Set.of(HttpMethod.GET, HttpMethod.HEAD, HttpMethod.OPTIONS);

    /** The paths a key never reaches. */
    static final List<String> NOT_WITH_A_KEY =
            List.of("/api/v1/accounts/session", "/api/v1/accounts/me/sessions", MyAccessKeysResource.PATH);

    private static final String READ_ONLY = """
            {"type":"about:blank","title":"Forbidden","status":403,\
            "detail":"This access key was created without the write switch: it only reads."}""";

    private static final String NEEDS_A_PERSON = """
            {"type":"about:blank","title":"Forbidden","status":403,\
            "detail":"Sessions and access keys are managed by a person signed in, not with an access key."}""";

    private final AccessKeyAudit audit;

    public AccessKeyGuard(AccessKeyAudit audit) {
        this.audit = audit;
    }

    void register(@Observes Router router) {
        router.route().order(ORDER).handler(this::guard);
    }

    private void guard(RoutingContext context) {
        SecurityIdentity identity = context.user() instanceof QuarkusHttpUser user ? user.getSecurityIdentity() : null;
        String key = identity == null ? null : identity.getAttribute(AccessKeyRegistry.ATTRIBUTE);
        if (key == null) {
            context.next();
            return;
        }
        String path = context.normalizedPath();
        if (notWithAKey(path)) {
            refuse(context, identity, key, "not-with-a-key", NEEDS_A_PERSON);
            return;
        }
        if (!READ.contains(context.request().method())
                && !Boolean.parseBoolean(identity.getAttribute(AccessKeyRegistry.WRITE_ATTRIBUTE))) {
            refuse(context, identity, key, "read-only", READ_ONLY);
            return;
        }
        context.next();
    }

    /** Whether a path is one a key never reaches. */
    static boolean notWithAKey(String path) {
        return path != null && NOT_WITH_A_KEY.stream().anyMatch(path::startsWith);
    }

    private void refuse(RoutingContext context, SecurityIdentity identity, String key, String reason, String body) {
        String method = context.request().method().name();
        String path = context.normalizedPath();
        String actor = identity.getPrincipal().getName();
        String organization = identity.getAttribute(OrganizationAccess.ORGANIZATION_ATTRIBUTE);
        var refused = new AccessKeyAudit.Key(
                UUID.fromString(key),
                organization == null ? null : UUID.fromString(organization),
                identity.getAttribute(AccessKeyRegistry.PREFIX_ATTRIBUTE),
                null);
        context.vertx()
                .executeBlocking(() -> {
                    audit.refused(actor, refused, method, path, reason);
                    return null;
                })
                .onComplete(ignored -> context.response()
                        .setStatusCode(403)
                        .putHeader(HttpHeaders.CONTENT_TYPE, "application/problem+json")
                        .end(body));
    }
}
