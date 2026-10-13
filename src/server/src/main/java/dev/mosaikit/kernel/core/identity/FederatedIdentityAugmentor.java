// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import dev.mosaikit.kernel.core.account.SessionClient;
import dev.mosaikit.kernel.core.account.SessionRegistry;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.oidc.runtime.OidcUtils;
import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.identity.AuthenticationRequestContext;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.SecurityIdentityAugmentor;
import io.quarkus.security.runtime.QuarkusPrincipal;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.quarkus.vertx.http.runtime.security.HttpSecurityUtils;
import io.smallrye.mutiny.Uni;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.eclipse.microprofile.jwt.JsonWebToken;

/**
 * Turns an identity verified by the realm of an organization into a kernel identity: the
 * principal is the account, the organization is the one of the realm, and the roles are the
 * kernel roles granted by the realm. Other roles of the realm are dropped, so a realm can never
 * grant {@code platform-admin}.
 *
 * <p>The kernel keeps the session of the realm that the token belongs to (its {@code sid} claim) as a
 * session of the person (MK-125): once ended, by signing out, from the settings of the person or by a
 * suspension, its tokens are refused, refreshed ones included. A suspended account is refused
 * whatever its token.
 */
@ApplicationScoped
public class FederatedIdentityAugmentor implements SecurityIdentityAugmentor {

    /** Realm role that makes a person manager of the organization. */
    public static final String ORGANIZATION_ADMIN_REALM_ROLE = Roles.ORGANIZATION_ADMIN;

    private final IdentityDirectory directory;
    private final FederatedAccounts accounts;
    private final SessionRegistry sessions;

    public FederatedIdentityAugmentor(
            IdentityDirectory directory, FederatedAccounts accounts, SessionRegistry sessions) {
        this.directory = directory;
        this.accounts = accounts;
        this.sessions = sessions;
    }

    @Override
    public Uni<SecurityIdentity> augment(SecurityIdentity identity, AuthenticationRequestContext context) {
        return augment(identity, context, Map.of());
    }

    @Override
    public Uni<SecurityIdentity> augment(
            SecurityIdentity identity, AuthenticationRequestContext context, Map<String, Object> attributes) {
        if (identity.isAnonymous() || !(identity.getPrincipal() instanceof JsonWebToken)) {
            return Uni.createFrom().item(identity);
        }
        String tenantId = identity.getAttribute(OidcUtils.TENANT_ID_ATTRIBUTE);
        var slug = TenantIds.slug(tenantId);
        if (slug.isEmpty()) {
            return Uni.createFrom().item(identity);
        }
        RoutingContext routing = HttpSecurityUtils.getRoutingContextAttribute(attributes);
        if (routing == null) {
            routing = HttpSecurityUtils.getRoutingContextAttribute(identity);
        }
        SessionClient client = SessionClient.of(routing);
        return context.runBlocking(() -> federate(identity, slug.get(), client));
    }

    private SecurityIdentity federate(SecurityIdentity identity, String slug, SessionClient client) {
        var organization = directory
                .routing()
                .bySlug(slug)
                .filter(OrganizationIdentity::federated)
                .orElseThrow(AuthenticationFailedException::new);
        var token = (JsonWebToken) identity.getPrincipal();
        String email = token.getClaim("email");
        if (email == null || email.isBlank() || token.getSubject() == null) {
            throw new AuthenticationFailedException("The realm must state the subject and the email address");
        }
        Object verified = token.getClaim("email_verified");
        String name = token.getClaim("name");
        FederatedAccounts.Member member = accounts.signIn(new FederatedSignIn(
                organization.id(),
                token.getSubject(),
                email,
                Boolean.TRUE.equals(verified) || "true".equals(String.valueOf(verified)),
                name == null || name.isBlank() ? email : name,
                kernelRoles(identity.getRoles())));
        if (member.account().isSuspended()) {
            throw new AuthenticationFailedException("The account is suspended");
        }
        UUID accountId = member.account().getId();
        Optional<SessionRegistry.Active> session = realmSession(token)
                .map(sid -> sessions.ofRealm(accountId, organization.id(), token.getIssuer(), sid, client)
                        .orElseThrow(() -> new AuthenticationFailedException("The session was ended")));
        session.ifPresent(active -> sessions.seen(active, organization.id()));
        // Only the roles in this organization: the roles of the platform need a password (MK-017), so
        // that a realm can never grant them.
        var builder = QuarkusSecurityIdentity.builder();
        session.ifPresent(active ->
                builder.addAttribute(SessionRegistry.ATTRIBUTE, active.id().toString()));
        return builder.setPrincipal(new QuarkusPrincipal(member.account().getUsername()))
                .addCredentials(identity.getCredentials())
                .addRoles(member.member().getRoles())
                .addAttribute(OidcUtils.TENANT_ID_ATTRIBUTE, identity.getAttribute(OidcUtils.TENANT_ID_ATTRIBUTE))
                .addAttribute(
                        OrganizationAccess.ORGANIZATION_ATTRIBUTE,
                        organization.id().toString())
                .addAttribute(OrganizationAccess.SLUG_ATTRIBUTE, organization.slug())
                .addAttribute(
                        OrganizationAccess.ACCOUNT_ATTRIBUTE,
                        member.account().getId().toString())
                .build();
    }

    /**
     * The session of the realm a token belongs to: its {@code sid} claim, or {@code session_state}
     * for realms that still name it so. A token without either is checked for the account only.
     */
    static Optional<String> realmSession(JsonWebToken token) {
        for (String claim : new String[] {"sid", "session_state"}) {
            Object value = token.getClaim(claim);
            if (value != null && !value.toString().isBlank()) {
                return Optional.of(value.toString());
            }
        }
        return Optional.empty();
    }

    /** Kernel roles granted by the roles of a realm. */
    static Set<String> kernelRoles(Set<String> realmRoles) {
        return realmRoles.contains(ORGANIZATION_ADMIN_REALM_ROLE)
                ? Set.of(Roles.ORGANIZATION_ADMIN, Roles.ORGANIZATION_USER)
                : Set.of(Roles.ORGANIZATION_USER);
    }
}
