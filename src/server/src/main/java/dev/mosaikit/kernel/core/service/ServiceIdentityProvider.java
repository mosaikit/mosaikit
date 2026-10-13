// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.service;

import dev.mosaikit.kernel.core.identity.IdentityDirectory;
import dev.mosaikit.kernel.core.identity.OrganizationAccess;
import dev.mosaikit.kernel.core.identity.OrganizationIdentity;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.identity.AuthenticationRequestContext;
import io.quarkus.security.identity.IdentityProvider;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.runtime.QuarkusPrincipal;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.quarkus.vertx.http.runtime.security.HttpSecurityUtils;
import io.smallrye.mutiny.Uni;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/**
 * The identity of a request made with the key of a service identity (MK-124): the principal {@code
 * service:<name>}, the single role {@value Roles#SERVICE}, no account and no organization. A service
 * acts on an organization only when the request names one with {@value OrganizationAccess#HEADER}
 * that a platform administrator allowed it; naming another one gets the request refused by {@link
 * ServiceGuard}. A revoked key opens nothing, and its use is audited, as is the first call of each
 * identity to each API it was given in an hour.
 */
@ApplicationScoped
public class ServiceIdentityProvider implements IdentityProvider<ServiceKeyAuthenticationRequest> {

    private final ServiceRegistry registry;
    private final IdentityDirectory directory;
    private final ServiceAudit audit;

    public ServiceIdentityProvider(ServiceRegistry registry, IdentityDirectory directory, ServiceAudit audit) {
        this.registry = registry;
        this.directory = directory;
        this.audit = audit;
    }

    @Override
    public Class<ServiceKeyAuthenticationRequest> getRequestType() {
        return ServiceKeyAuthenticationRequest.class;
    }

    @Override
    public Uni<SecurityIdentity> authenticate(
            ServiceKeyAuthenticationRequest request, AuthenticationRequestContext context) {
        RoutingContext routing = HttpSecurityUtils.getRoutingContextAttribute(request);
        String method = routing == null ? null : routing.request().method().name();
        String path = routing == null ? null : routing.normalizedPath();
        String requested = routing == null ? null : routing.request().getHeader(OrganizationAccess.HEADER);
        return context.runBlocking(() -> identityOf(request.getKey(), method, path, requested));
    }

    private SecurityIdentity identityOf(String secret, String method, String path, String requested) {
        ServiceRegistry.Active key = registry.find(secret).orElseThrow(AuthenticationFailedException::new);
        if (key.revoked()) {
            audit.refused(ServiceAudit.Caller.of(key, null), ServiceGuard.target(path), method, path, "revoked");
            throw new AuthenticationFailedException();
        }
        registry.used(key);
        var builder = QuarkusSecurityIdentity.builder()
                .setPrincipal(new QuarkusPrincipal(ServiceAudit.actor(key.name())))
                .addRole(Roles.SERVICE)
                .addAttribute(ServiceRegistry.ATTRIBUTE, key.serviceId().toString())
                .addAttribute(ServiceRegistry.NAME_ATTRIBUTE, key.name())
                .addAttribute(ServiceRegistry.KEY_ATTRIBUTE, key.keyId().toString())
                .addAttribute(ServiceRegistry.PREFIX_ATTRIBUTE, key.prefix())
                .addAttribute(ServiceGuard.GRANTS_ATTRIBUTE, key.grants());
        UUID organization = null;
        boolean refused = false;
        if (requested != null && !requested.isBlank()) {
            String slug = requested.strip().toLowerCase(Locale.ROOT);
            Optional<OrganizationIdentity> allowed = directory
                    .routing()
                    .bySlug(slug)
                    .filter(found -> key.grants().organizations().contains(found.id()));
            if (allowed.isPresent()) {
                organization = allowed.get().id();
                builder.addAttribute(
                                OrganizationAccess.ORGANIZATION_ATTRIBUTE,
                                allowed.get().id().toString())
                        .addAttribute(
                                OrganizationAccess.SLUG_ATTRIBUTE, allowed.get().slug());
            } else {
                builder.addAttribute(ServiceRegistry.REFUSED_ORGANIZATION_ATTRIBUTE, slug);
                refused = true;
            }
        }
        // The first call to each API in an hour, here during authentication, before the request goes on;
        // ServiceGuard refuses the others and audits each refusal.
        String target = ServiceGuard.target(path);
        if (!refused
                && ServiceGuard.allowed(key.grants(), target)
                && registry.firstUseThisHour(key.serviceId(), target)) {
            audit.used(ServiceAudit.Caller.of(key, organization), target, method, path);
        }
        return builder.build();
    }
}
