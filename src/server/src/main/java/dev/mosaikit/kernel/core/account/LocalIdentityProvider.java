// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.identity.OrganizationAccess;
import dev.mosaikit.kernel.core.security.PasswordHasher;
import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.identity.AuthenticationRequestContext;
import io.quarkus.security.identity.IdentityProvider;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.request.UsernamePasswordAuthenticationRequest;
import io.quarkus.security.runtime.QuarkusPrincipal;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.quarkus.vertx.http.runtime.security.HttpSecurityUtils;
import io.smallrye.mutiny.Uni;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;

/**
 * Authenticates local accounts with username and password. It works without any external
 * identity provider, so that portable installations and emergency access keep working.
 */
@ApplicationScoped
public class LocalIdentityProvider implements IdentityProvider<UsernamePasswordAuthenticationRequest> {

    private final AccountService accounts;
    private final PasswordHasher passwordHasher;
    private final OrganizationAccess access;

    public LocalIdentityProvider(AccountService accounts, PasswordHasher passwordHasher, OrganizationAccess access) {
        this.accounts = accounts;
        this.passwordHasher = passwordHasher;
        this.access = access;
    }

    @Override
    public Class<UsernamePasswordAuthenticationRequest> getRequestType() {
        return UsernamePasswordAuthenticationRequest.class;
    }

    @Override
    public Uni<SecurityIdentity> authenticate(
            UsernamePasswordAuthenticationRequest request, AuthenticationRequestContext context) {
        RoutingContext routing = HttpSecurityUtils.getRoutingContextAttribute(request);
        String requested = OrganizationAccess.requested(routing);
        String host = routing == null || routing.request().authority() == null
                ? null
                : routing.request().authority().host();
        return context.runBlocking(
                () -> verify(request.getUsername(), request.getPassword().getPassword(), requested, host));
    }

    private SecurityIdentity verify(String username, char[] password, String requested, String host) {
        var account = accounts.findForAuthentication(username);
        if (account.isEmpty()) {
            passwordHasher.simulateVerification(password);
            throw new AuthenticationFailedException();
        }
        UserAccount found = account.get();
        var hash = found.getPasswordHash();
        if (hash.isEmpty()) {
            // Account without password: it signs in through the realms of its organizations only.
            passwordHasher.simulateVerification(password);
            throw new AuthenticationFailedException();
        }
        if (!passwordHasher.verify(password, hash.get())) {
            throw new AuthenticationFailedException();
        }
        if (!found.isEmailConfirmed()) {
            // Registered, but the link sent to the address was not opened yet.
            throw new AuthenticationFailedException();
        }
        return identityOf(found, requested, host);
    }

    /**
     * The identity of a local account, with its roles in the organization the request acts on;
     * shared with {@link SessionIdentityProvider}, so that a session has the same rights as Basic.
     */
    SecurityIdentity identityOf(UserAccount found, String requested, String host) {
        var builder = QuarkusSecurityIdentity.builder()
                .setPrincipal(new QuarkusPrincipal(found.getUsername()))
                .addRoles(found.getRoles())
                .addAttribute(
                        OrganizationAccess.ACCOUNT_ATTRIBUTE, found.getId().toString());
        // The roles in an organization count only for the organization the request acts on (MK-017).
        access.forPassword(found.getId(), requested, host)
                .ifPresent(organization -> builder.addRoles(organization.roles())
                        .addAttribute(
                                OrganizationAccess.ORGANIZATION_ATTRIBUTE,
                                organization.organizationId().toString())
                        .addAttribute(OrganizationAccess.SLUG_ATTRIBUTE, organization.slug()));
        return builder.build();
    }
}
