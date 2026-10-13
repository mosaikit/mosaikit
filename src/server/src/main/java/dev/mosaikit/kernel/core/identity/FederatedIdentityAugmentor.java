// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.oidc.runtime.OidcUtils;
import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.identity.AuthenticationRequestContext;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.SecurityIdentityAugmentor;
import io.quarkus.security.runtime.QuarkusPrincipal;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.smallrye.mutiny.Uni;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Set;
import org.eclipse.microprofile.jwt.JsonWebToken;

/**
 * Turns an identity verified by the realm of an organization into a kernel identity: the
 * principal is the account, the organization is the one of the realm, and the roles are the
 * kernel roles granted by the realm. Other roles of the realm are dropped, so a realm can never
 * grant {@code platform-admin}.
 */
@ApplicationScoped
public class FederatedIdentityAugmentor implements SecurityIdentityAugmentor {

    /** Realm role that makes a person manager of the organization. */
    public static final String ORGANIZATION_ADMIN_REALM_ROLE = Roles.ORGANIZATION_ADMIN;

    private final IdentityDirectory directory;
    private final FederatedAccounts accounts;

    public FederatedIdentityAugmentor(IdentityDirectory directory, FederatedAccounts accounts) {
        this.directory = directory;
        this.accounts = accounts;
    }

    @Override
    public Uni<SecurityIdentity> augment(SecurityIdentity identity, AuthenticationRequestContext context) {
        if (identity.isAnonymous() || !(identity.getPrincipal() instanceof JsonWebToken)) {
            return Uni.createFrom().item(identity);
        }
        String tenantId = identity.getAttribute(OidcUtils.TENANT_ID_ATTRIBUTE);
        var slug = TenantIds.slug(tenantId);
        if (slug.isEmpty()) {
            return Uni.createFrom().item(identity);
        }
        return context.runBlocking(() -> federate(identity, slug.get()));
    }

    private SecurityIdentity federate(SecurityIdentity identity, String slug) {
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
        // Only the roles in this organization: the roles of the platform need a password (MK-017), so
        // that a realm can never grant them.
        return QuarkusSecurityIdentity.builder()
                .setPrincipal(new QuarkusPrincipal(member.account().getUsername()))
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

    /** Kernel roles granted by the roles of a realm. */
    static Set<String> kernelRoles(Set<String> realmRoles) {
        return realmRoles.contains(ORGANIZATION_ADMIN_REALM_ROLE)
                ? Set.of(Roles.ORGANIZATION_ADMIN, Roles.ORGANIZATION_USER)
                : Set.of(Roles.ORGANIZATION_USER);
    }
}
