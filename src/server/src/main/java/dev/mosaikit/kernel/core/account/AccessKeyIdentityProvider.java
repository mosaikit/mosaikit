// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.identity.OrganizationAccess;
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
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;

/**
 * The identity of a request made with a personal access key (MK-060): the person of the key, acting
 * on the organization of the key with the roles they have there now, read again for every request as
 * for sessions. The roles of the platform are left out: they need a password (MK-017), and a key acts
 * in one organization only. A key that was revoked or expired, of a suspended person or of a person
 * no longer in its organization opens nothing. Every request is audited.
 */
@ApplicationScoped
public class AccessKeyIdentityProvider implements IdentityProvider<AccessKeyAuthenticationRequest> {

    private final AccessKeyRegistry keys;
    private final AccountService accounts;
    private final OrganizationAccess access;
    private final AccessKeyAudit audit;
    private final Clock clock;

    public AccessKeyIdentityProvider(
            AccessKeyRegistry keys,
            AccountService accounts,
            OrganizationAccess access,
            AccessKeyAudit audit,
            Clock clock) {
        this.keys = keys;
        this.accounts = accounts;
        this.access = access;
        this.audit = audit;
        this.clock = clock;
    }

    @Override
    public Class<AccessKeyAuthenticationRequest> getRequestType() {
        return AccessKeyAuthenticationRequest.class;
    }

    @Override
    public Uni<SecurityIdentity> authenticate(
            AccessKeyAuthenticationRequest request, AuthenticationRequestContext context) {
        RoutingContext routing = HttpSecurityUtils.getRoutingContextAttribute(request);
        String method = routing == null ? null : routing.request().method().name();
        String path = routing == null ? null : routing.normalizedPath();
        return context.runBlocking(() -> identityOf(request.getKey(), method, path));
    }

    private SecurityIdentity identityOf(String secret, String method, String path) {
        AccessKeyRegistry.Active key = keys.find(secret).orElseThrow(AuthenticationFailedException::new);
        Optional<UserAccount> account = accounts.findForAuthentication(key.accountId());
        String actor = account.map(UserAccount::getUsername).orElse(key.prefix());
        Instant now = Instant.now(clock);
        if (!key.live(now)) {
            throw refused(actor, key, method, path, key.revoked() ? "revoked" : "expired");
        }
        if (account.isEmpty() || account.get().isSuspended()) {
            throw refused(actor, key, method, path, "suspended");
        }
        OrganizationAccess.Access organization = access.forKey(key.accountId(), key.organizationId())
                .orElseThrow(() -> refused(actor, key, method, path, "not-a-member"));
        keys.used(key);
        audit.used(actor, AccessKeyAudit.Key.of(key), method, path);
        return QuarkusSecurityIdentity.builder()
                .setPrincipal(new QuarkusPrincipal(account.get().getUsername()))
                .addRoles(organization.roles())
                .addAttribute(
                        OrganizationAccess.ACCOUNT_ATTRIBUTE, key.accountId().toString())
                .addAttribute(
                        OrganizationAccess.ORGANIZATION_ATTRIBUTE,
                        organization.organizationId().toString())
                .addAttribute(OrganizationAccess.SLUG_ATTRIBUTE, organization.slug())
                .addAttribute(AccessKeyRegistry.ATTRIBUTE, key.id().toString())
                .addAttribute(AccessKeyRegistry.PREFIX_ATTRIBUTE, key.prefix())
                .addAttribute(AccessKeyRegistry.WRITE_ATTRIBUTE, Boolean.toString(key.canWrite()))
                .build();
    }

    private AuthenticationFailedException refused(
            String actor, AccessKeyRegistry.Active key, String method, String path, String reason) {
        audit.refused(actor, AccessKeyAudit.Key.of(key), method, path, reason);
        return new AuthenticationFailedException();
    }
}
