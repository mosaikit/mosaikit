// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.identity.OrganizationAccess;
import io.quarkus.security.AuthenticationFailedException;
import io.quarkus.security.identity.AuthenticationRequestContext;
import io.quarkus.security.identity.IdentityProvider;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.vertx.http.runtime.security.HttpSecurityUtils;
import io.smallrye.mutiny.Uni;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;

/**
 * The identity of a request that carries the session cookie of the shell (see {@link
 * SessionResource}): the cookie holds a random value that finds a live session the kernel keeps
 * (MK-125). Roles and organization are read again for every request, as for HTTP Basic; a session
 * that ended, or whose account was suspended or lost its local password, opens nothing.
 */
@ApplicationScoped
public class SessionIdentityProvider implements IdentityProvider<SessionAuthenticationRequest> {

    private final AccountService accounts;
    private final LocalIdentityProvider local;
    private final SessionRegistry sessions;

    public SessionIdentityProvider(AccountService accounts, LocalIdentityProvider local, SessionRegistry sessions) {
        this.accounts = accounts;
        this.local = local;
        this.sessions = sessions;
    }

    @Override
    public Class<SessionAuthenticationRequest> getRequestType() {
        return SessionAuthenticationRequest.class;
    }

    @Override
    public Uni<SecurityIdentity> authenticate(
            SessionAuthenticationRequest request, AuthenticationRequestContext context) {
        RoutingContext routing = HttpSecurityUtils.getRoutingContextAttribute(request);
        String requested = OrganizationAccess.requested(routing);
        String host = routing == null || routing.request().authority() == null
                ? null
                : routing.request().authority().host();
        return context.runBlocking(() -> {
            SessionRegistry.Active session =
                    sessions.byCookie(request.getToken()).orElseThrow(AuthenticationFailedException::new);
            UserAccount found = accounts.findForAuthentication(session.accountId())
                    .filter(account -> account.getPasswordHash().isPresent())
                    .filter(UserAccount::isEmailConfirmed)
                    .filter(account -> !account.isSuspended())
                    .orElseThrow(AuthenticationFailedException::new);
            SecurityIdentity identity = local.identityOf(found, requested, host, session.id());
            sessions.seen(session, LocalIdentityProvider.organizationOf(identity));
            return identity;
        });
    }
}
