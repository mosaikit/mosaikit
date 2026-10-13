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
import io.vertx.core.http.HttpHeaders;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;

/**
 * Signs a request in with a personal access key (MK-060), sent as {@code Authorization: Bearer
 * mk_...}. A bearer token that does not start with {@value AccessKeyRegistry#KEY_START} is left to
 * the other mechanisms, such as the tokens of the realms of organizations. A key that is unknown,
 * revoked or expired, or whose person may no longer use it, fails the request with 401: it never
 * falls back to another way of signing in.
 */
@ApplicationScoped
public class AccessKeyMechanism implements HttpAuthenticationMechanism {

    /** Above the tokens of the realms (OIDC) and the session of the shell, which never read keys. */
    static final int PRIORITY = 2000;

    private static final String BEARER = "bearer ";

    @Override
    public Uni<SecurityIdentity> authenticate(RoutingContext context, IdentityProviderManager identityProviderManager) {
        Optional<String> key = key(context.request().getHeader(HttpHeaders.AUTHORIZATION));
        if (key.isEmpty()) {
            return Uni.createFrom().optional(Optional.empty());
        }
        var request = new AccessKeyAuthenticationRequest(key.get());
        HttpSecurityUtils.setRoutingContextAttribute(request, context);
        return identityProviderManager.authenticate(request);
    }

    /** The access key of an {@code Authorization} header, if it holds one. */
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
        return AccessKeyRegistry.looksLikeKey(token) ? Optional.of(token) : Optional.empty();
    }

    @Override
    public Uni<ChallengeData> getChallenge(RoutingContext context) {
        return Uni.createFrom().nullItem();
    }

    @Override
    public Set<Class<? extends AuthenticationRequest>> getCredentialTypes() {
        return Set.of(AccessKeyAuthenticationRequest.class);
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
