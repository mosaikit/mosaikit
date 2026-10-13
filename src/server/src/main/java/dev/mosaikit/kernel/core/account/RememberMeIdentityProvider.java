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
 * The identity of a request signed in by its "remember me" token: the same as with the password
 * (see {@link LocalIdentityProvider#identityOf}), with roles and organization read again. The request
 * belongs to the session of the token (MK-125); when that session ended by itself, the token opens a
 * new one and moves to it.
 */
@ApplicationScoped
public class RememberMeIdentityProvider implements IdentityProvider<RememberMeAuthenticationRequest> {

    private final RememberMe rememberMe;
    private final LocalIdentityProvider local;
    private final SessionRegistry sessions;
    private final SessionStore store;

    public RememberMeIdentityProvider(
            RememberMe rememberMe, LocalIdentityProvider local, SessionRegistry sessions, SessionStore store) {
        this.rememberMe = rememberMe;
        this.local = local;
        this.sessions = sessions;
        this.store = store;
    }

    @Override
    public Class<RememberMeAuthenticationRequest> getRequestType() {
        return RememberMeAuthenticationRequest.class;
    }

    @Override
    public Uni<SecurityIdentity> authenticate(
            RememberMeAuthenticationRequest request, AuthenticationRequestContext context) {
        RoutingContext routing = HttpSecurityUtils.getRoutingContextAttribute(request);
        String requested = OrganizationAccess.requested(routing);
        String host = routing == null || routing.request().authority() == null
                ? null
                : routing.request().authority().host();
        return context.runBlocking(() -> {
            RememberMe.Remembered remembered =
                    rememberMe.find(request.getToken()).orElseThrow(AuthenticationFailedException::new);
            SessionRegistry.Active session = remembered
                    .session()
                    .flatMap(sessions::byId)
                    .orElseGet(() -> {
                        var opened = sessions.open(remembered.account().getId(), null, SessionClient.of(routing));
                        store.moveToken(remembered.tokenId(), opened.id());
                        return sessions.byId(opened.id()).orElseThrow(AuthenticationFailedException::new);
                    });
            SecurityIdentity identity = local.identityOf(remembered.account(), requested, host, session.id());
            sessions.seen(session, LocalIdentityProvider.organizationOf(identity));
            return identity;
        });
    }
}
