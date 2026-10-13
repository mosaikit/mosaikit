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
import java.util.Optional;
import java.util.Set;

/**
 * Signs a request in with the session cookie of the shell ({@value SessionResource#COOKIE}), checked
 * against the sessions the kernel keeps (MK-125). A cookie of an ended, expired or unknown session
 * leaves the request anonymous: an API that needs a person answers 401, and the "remember me" cookie,
 * tried next, may still sign the person in.
 */
@ApplicationScoped
public class SessionMechanism implements HttpAuthenticationMechanism {

    /** Above "remember me" ({@link RememberMeMechanism#PRIORITY}). */
    static final int PRIORITY = 1000;

    @Override
    public Uni<SecurityIdentity> authenticate(RoutingContext context, IdentityProviderManager identityProviderManager) {
        Cookie cookie = context.request().getCookie(SessionResource.COOKIE);
        if (cookie == null || cookie.getValue().isBlank()) {
            return Uni.createFrom().optional(Optional.empty());
        }
        var request = new SessionAuthenticationRequest(cookie.getValue());
        HttpSecurityUtils.setRoutingContextAttribute(request, context);
        return identityProviderManager.authenticate(request).onFailure().recoverWithNull();
    }

    @Override
    public Uni<ChallengeData> getChallenge(RoutingContext context) {
        return Uni.createFrom().nullItem();
    }

    @Override
    public Set<Class<? extends AuthenticationRequest>> getCredentialTypes() {
        return Set.of(SessionAuthenticationRequest.class);
    }

    @Override
    public Uni<HttpCredentialTransport> getCredentialTransport(RoutingContext context) {
        return Uni.createFrom()
                .item(new HttpCredentialTransport(HttpCredentialTransport.Type.COOKIE, SessionResource.COOKIE));
    }

    @Override
    public int getPriority() {
        return PRIORITY;
    }
}
