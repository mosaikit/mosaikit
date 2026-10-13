// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.identity.OrganizationAccess;
import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.identity.AuthenticationRequestContext;
import io.quarkus.security.identity.IdentityProvider;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.request.TrustedAuthenticationRequest;
import io.quarkus.vertx.http.runtime.security.HttpSecurityUtils;
import io.smallrye.mutiny.Uni;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;

/**
 * The identity of a request that carries the session cookie of the shell (see {@link
 * SessionResource}): the cookie holds only the username, verified with the password when the session
 * was opened. Roles and organization are read again for every request, as for HTTP Basic, and an
 * account that no longer exists, or no longer has a local password, loses its session.
 */
@ApplicationScoped
public class SessionIdentityProvider implements IdentityProvider<TrustedAuthenticationRequest> {

    private final AccountService accounts;
    private final LocalIdentityProvider local;

    public SessionIdentityProvider(AccountService accounts, LocalIdentityProvider local) {
        this.accounts = accounts;
        this.local = local;
    }

    @Override
    public Class<TrustedAuthenticationRequest> getRequestType() {
        return TrustedAuthenticationRequest.class;
    }

    @Override
    public Uni<SecurityIdentity> authenticate(
            TrustedAuthenticationRequest request, AuthenticationRequestContext context) {
        RoutingContext routing = HttpSecurityUtils.getRoutingContextAttribute(request);
        String requested = OrganizationAccess.requested(routing);
        String host = routing == null || routing.request().authority() == null
                ? null
                : routing.request().authority().host();
        return context.runBlocking(() -> {
            UserAccount found = accounts.findForAuthentication(request.getPrincipal())
                    .filter(account -> account.getPasswordHash().isPresent())
                    .filter(UserAccount::isEmailConfirmed)
                    .orElseThrow(AuthenticationFailedException::new);
            return local.identityOf(found, requested, host);
        });
    }
}
