// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.service;

import dev.mosaikit.kernel.core.identity.RequestOrganization;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.vertx.http.runtime.security.QuarkusHttpUser;
import io.vertx.core.http.HttpHeaders;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import java.util.UUID;

/**
 * What a request of a service identity (MK-124) may reach: the APIs of extensions it was given
 * ({@code /api/v1/ext/<api>/}) and, when it was given an endpoint of the kernel meant for services,
 * {@value ServiceCheckResource#PATH}. Every other path, the shell and the other APIs of the kernel
 * included, answers 403, as does a request that names an organization the identity may not name.
 * Every refusal is audited here; the first call of each identity to each API in an hour, by {@link
 * ServiceIdentityProvider}.
 */
@ApplicationScoped
public class ServiceGuard {

    /** After authentication (-200) and the permission check (-100), before the extension APIs (-50). */
    static final int ORDER = -58;

    /** Attribute of the security identity: what the identity may call ({@link ServiceIdentity.Grants}). */
    static final String GRANTS_ATTRIBUTE = "mosaikit.service.grants";

    /** The target of the endpoint of the kernel that checks sessions and keys, in the grants and the audit. */
    static final String CHECK = "services/check";

    private static final String EXTENSION_APIS = "/api/v1/ext/";

    private static final String NOT_GRANTED = """
            {"type":"about:blank","title":"Forbidden","status":403,\
            "detail":"This service identity was not given this API."}""";

    private static final String ORGANIZATION = """
            {"type":"about:blank","title":"Forbidden","status":403,\
            "detail":"This service identity may not act on the organization it named."}""";

    private final ServiceAudit audit;

    public ServiceGuard(ServiceAudit audit) {
        this.audit = audit;
    }

    void register(@Observes Router router) {
        router.route().order(ORDER).handler(this::guard);
    }

    private void guard(RoutingContext context) {
        SecurityIdentity identity = context.user() instanceof QuarkusHttpUser user ? user.getSecurityIdentity() : null;
        String service = identity == null ? null : identity.getAttribute(ServiceRegistry.ATTRIBUTE);
        if (service == null) {
            context.next();
            return;
        }
        String method = context.request().method().name();
        String path = context.normalizedPath();
        String target = target(path);
        ServiceAudit.Caller caller = new ServiceAudit.Caller(
                UUID.fromString(service),
                identity.getAttribute(ServiceRegistry.NAME_ATTRIBUTE),
                UUID.fromString(identity.getAttribute(ServiceRegistry.KEY_ATTRIBUTE)),
                identity.getAttribute(ServiceRegistry.PREFIX_ATTRIBUTE),
                RequestOrganization.of(identity).orElse(null));
        if (identity.getAttribute(ServiceRegistry.REFUSED_ORGANIZATION_ATTRIBUTE) != null) {
            refuse(context, caller, target, method, path, "organization", ORGANIZATION);
            return;
        }
        if (!allowed(identity.getAttribute(GRANTS_ATTRIBUTE), target)) {
            refuse(context, caller, target, method, path, "not-granted", NOT_GRANTED);
            return;
        }
        context.next();
    }

    /**
     * What a path is to the grants: the name of an API of extensions, {@value #CHECK} for the endpoint
     * of the kernel meant for services (never the name of an API), or {@code null}.
     */
    static String target(String path) {
        if (path == null) {
            return null;
        }
        if (path.equals(ServiceCheckResource.PATH)) {
            return CHECK;
        }
        if (!path.startsWith(EXTENSION_APIS)) {
            return null;
        }
        String rest = path.substring(EXTENSION_APIS.length());
        int slash = rest.indexOf('/');
        String name = slash < 0 ? rest : rest.substring(0, slash);
        return name.isEmpty() ? null : name;
    }

    /** Whether grants allow a target; the endpoint of the kernel checks which of its kinds. */
    static boolean allowed(ServiceIdentity.Grants grants, String target) {
        if (grants == null || target == null) {
            return false;
        }
        if (CHECK.equals(target)) {
            return !grants.endpoints().isEmpty();
        }
        return grants.apis().contains(target);
    }

    private void refuse(
            RoutingContext context,
            ServiceAudit.Caller caller,
            String target,
            String method,
            String path,
            String reason,
            String body) {
        context.vertx()
                .executeBlocking(() -> {
                    audit.refused(caller, target, method, path, reason);
                    return null;
                })
                .onComplete(ignored -> context.response()
                        .setStatusCode(403)
                        .putHeader(HttpHeaders.CONTENT_TYPE, "application/problem+json")
                        .end(body));
    }
}
