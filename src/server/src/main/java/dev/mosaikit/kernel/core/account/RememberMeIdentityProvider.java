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
 * (see {@link LocalIdentityProvider#identityOf}), with roles and organization read again.
 */
@ApplicationScoped
public class RememberMeIdentityProvider implements IdentityProvider<RememberMeAuthenticationRequest> {

    private final RememberMe rememberMe;
    private final LocalIdentityProvider local;

    public RememberMeIdentityProvider(RememberMe rememberMe, LocalIdentityProvider local) {
        this.rememberMe = rememberMe;
        this.local = local;
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
        return context.runBlocking(() -> rememberMe
                .accountOf(request.getToken())
                .map(account -> local.identityOf(account, requested, host))
                .orElseThrow(AuthenticationFailedException::new));
    }
}
