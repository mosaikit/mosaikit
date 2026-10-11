// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import io.quarkus.security.identity.IdentityProviderManager;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.request.AuthenticationRequest;
import io.quarkus.vertx.http.runtime.security.ChallengeData;
import io.quarkus.vertx.http.runtime.security.HttpAuthenticationMechanism;
import io.quarkus.vertx.http.runtime.security.HttpCredentialTransport;
import io.quarkus.vertx.http.runtime.security.HttpSecurityUtils;
import io.smallrye.mutiny.Uni;
import io.vertx.core.http.Cookie;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Set;

/**
 * Signs a request in with its {@value RememberMe#COOKIE} cookie when no other mechanism did: after
 * the session of the shell, with the password or HTTP Basic. An unknown or expired token does not
 * fail the request, which stays anonymous; the shell then shows the sign-in.
 */
@ApplicationScoped
public class RememberMeMechanism implements HttpAuthenticationMechanism {

    /** Below form (session) and Basic authentication, which are tried first. */
    static final int PRIORITY = 500;

    @Override
    public Uni<SecurityIdentity> authenticate(RoutingContext context, IdentityProviderManager identityProviderManager) {
        Cookie cookie = context.request().getCookie(RememberMe.COOKIE);
        if (cookie == null || cookie.getValue().isBlank()) {
            return Uni.createFrom().optional(java.util.Optional.empty());
        }
        var request = new RememberMeAuthenticationRequest(cookie.getValue());
        HttpSecurityUtils.setRoutingContextAttribute(request, context);
        return identityProviderManager.authenticate(request).onFailure().recoverWithNull();
    }

    @Override
    public Uni<ChallengeData> getChallenge(RoutingContext context) {
        return Uni.createFrom().nullItem();
    }

    @Override
    public Set<Class<? extends AuthenticationRequest>> getCredentialTypes() {
        return Set.of(RememberMeAuthenticationRequest.class);
    }

    @Override
    public Uni<HttpCredentialTransport> getCredentialTransport(RoutingContext context) {
        return Uni.createFrom()
                .item(new HttpCredentialTransport(HttpCredentialTransport.Type.COOKIE, RememberMe.COOKIE));
    }

    @Override
    public int getPriority() {
        return PRIORITY;
    }
}
