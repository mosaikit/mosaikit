// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.service;

import io.quarkus.security.identity.IdentityProviderManager;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.security.identity.request.AuthenticationRequest;
import io.quarkus.vertx.http.runtime.security.ChallengeData;
import io.quarkus.vertx.http.runtime.security.HttpAuthenticationMechanism;
import io.quarkus.vertx.http.runtime.security.HttpCredentialTransport;
import io.quarkus.vertx.http.runtime.security.HttpSecurityUtils;
import io.smallrye.mutiny.Uni;
import io.vertx.core.http.HttpHeaders;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/**
 * Signs a request in with the key of a service identity (MK-124), sent as {@code Authorization: Bearer
 * mks_...}. A bearer token that does not start with {@value ServiceRegistry#KEY_START} is left to the
 * other mechanisms. A key that is unknown or revoked fails the request with 401: it never falls back to
 * another way of signing in.
 */
@ApplicationScoped
public class ServiceKeyMechanism implements HttpAuthenticationMechanism {

    /** Above the tokens of the realms (OIDC) and the session of the shell, which never read these keys. */
    static final int PRIORITY = 2100;

    private static final String BEARER = "bearer ";

    @Override
    public Uni<SecurityIdentity> authenticate(RoutingContext context, IdentityProviderManager identityProviderManager) {
        Optional<String> key = key(context.request().getHeader(HttpHeaders.AUTHORIZATION));
        if (key.isEmpty()) {
            return Uni.createFrom().optional(Optional.empty());
        }
        var request = new ServiceKeyAuthenticationRequest(key.get());
        HttpSecurityUtils.setRoutingContextAttribute(request, context);
        return identityProviderManager.authenticate(request);
    }

    /** The key of a service of an {@code Authorization} header, if it holds one. */
    static Optional<String> key(String authorization) {
        if (authorization == null
                || authorization.length() <= BEARER.length()
                || !authorization
                        .substring(0, BEARER.length())
                        .toLowerCase(Locale.ROOT)
                        .equals(BEARER)) {
            return Optional.empty();
        }
        String token = authorization.substring(BEARER.length()).strip();
        return ServiceRegistry.looksLikeKey(token) ? Optional.of(token) : Optional.empty();
    }

    @Override
    public Uni<ChallengeData> getChallenge(RoutingContext context) {
        return Uni.createFrom().nullItem();
    }

    @Override
    public Set<Class<? extends AuthenticationRequest>> getCredentialTypes() {
        return Set.of(ServiceKeyAuthenticationRequest.class);
    }

    @Override
    public Uni<HttpCredentialTransport> getCredentialTransport(RoutingContext context) {
        return Uni.createFrom().nullItem();
    }

    @Override
    public int getPriority() {
        return PRIORITY;
    }
}
