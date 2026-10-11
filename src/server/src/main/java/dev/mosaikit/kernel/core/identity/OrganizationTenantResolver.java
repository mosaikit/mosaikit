// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.config.KernelConfig;
import io.quarkus.oidc.OidcRequestContext;
import io.quarkus.oidc.OidcTenantConfig;
import io.quarkus.oidc.TenantConfigResolver;
import io.quarkus.oidc.runtime.OidcTenantConfig.ApplicationType;
import io.smallrye.mutiny.Uni;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import java.io.IOException;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Chooses the Keycloak realm that verifies a bearer token (MK-012). Each federated organization
 * is an OIDC tenant, created on first use, so the kernel starts and local accounts sign in even
 * when Keycloak is unreachable. Requests without a bearer token get the default tenant, which is
 * disabled, and are left to the other authentication mechanisms.
 *
 * <p>On the sub-domain of an organization ({@code mosaikit.identity.domain}) only the realm of that
 * organization is accepted. Elsewhere the organization comes from the issuer of the token, read
 * before the token is verified and only to choose the realm: the token is then verified with the
 * keys and the issuer of that realm, so a forged issuer can only select a realm that rejects it.
 */
@ApplicationScoped
public class OrganizationTenantResolver implements TenantConfigResolver {

    private static final String BEARER = "bearer ";
    private static final Duration CONNECTION_TIMEOUT = Duration.ofSeconds(5);

    private final IdentityDirectory directory;
    private final KernelConfig.Identity config;
    private final ObjectMapper json;
    private final Map<String, OidcTenantConfig> tenants = new ConcurrentHashMap<>();

    public OrganizationTenantResolver(IdentityDirectory directory, KernelConfig config, ObjectMapper json) {
        this.directory = directory;
        this.config = config.identity();
        this.json = json;
    }

    @Override
    public Uni<OidcTenantConfig> resolve(RoutingContext context, OidcRequestContext<OidcTenantConfig> requestContext) {
        if (config.keycloakUrl().isEmpty()) {
            return Uni.createFrom().nullItem();
        }
        Optional<String> token = bearerToken(context.request().getHeader("Authorization"));
        if (token.isEmpty()) {
            return Uni.createFrom().nullItem();
        }
        String host = context.request().authority() == null
                ? null
                : context.request().authority().host();
        var cached = directory.cached();
        if (cached.isPresent()) {
            return Uni.createFrom().item(tenantFor(cached.get(), host, token.get()));
        }
        return requestContext.runBlocking(() -> tenantFor(directory.routing(), host, token.get()));
    }

    private OidcTenantConfig tenantFor(IdentityRouting routing, String host, String token) {
        // On the sub-domain of an organization only its realm is accepted; elsewhere the issuer of
        // the token chooses among the realms of all organizations.
        Optional<OrganizationIdentity> organization = routing.byHost(host);
        if (organization.isEmpty()) {
            organization = issuer(json, token).flatMap(routing::byIssuer);
        }
        return organization
                .flatMap(found -> routing.issuer(found).map(issuer -> tenant(found, issuer)))
                .orElse(null);
    }

    private OidcTenantConfig tenant(OrganizationIdentity organization, String issuer) {
        String tenantId = TenantIds.of(organization.slug(), organization.realm().orElseThrow());
        String authServerUrl = internalUrl(issuer);
        return tenants.computeIfAbsent(
                tenantId,
                id -> OidcTenantConfig.builder()
                        .tenantId(id)
                        .authServerUrl(authServerUrl)
                        .clientId(config.clientId())
                        .applicationType(ApplicationType.SERVICE)
                        .connectionTimeout(CONNECTION_TIMEOUT)
                        // The issuer is the public URL, also when Keycloak is reached internally, and
                        // only tokens issued to the kernel UI client of the realm are accepted
                        .token()
                        .issuer(issuer)
                        .requiredClaims("azp", config.clientId())
                        .end()
                        .build());
    }

    /** The issuer rewritten to the internal Keycloak URL, when one is configured. */
    private String internalUrl(String issuer) {
        String publicUrl =
                withoutTrailingSlash(config.keycloakUrl().orElseThrow().toString());
        return config.keycloakInternalUrl()
                .map(internal -> withoutTrailingSlash(internal.toString()) + issuer.substring(publicUrl.length()))
                .orElse(issuer);
    }

    private static String withoutTrailingSlash(String url) {
        return url.endsWith("/") ? url.substring(0, url.length() - 1) : url;
    }

    static Optional<String> bearerToken(String authorization) {
        if (authorization == null
                || authorization.length() <= BEARER.length()
                || !authorization.regionMatches(true, 0, BEARER, 0, BEARER.length())) {
            return Optional.empty();
        }
        return Optional.of(authorization.substring(BEARER.length()).trim());
    }

    /** The {@code iss} claim of a JWT, read without verifying it. */
    static Optional<String> issuer(ObjectMapper json, String token) {
        String[] parts = token.split("\\.", -1);
        if (parts.length != 3) {
            return Optional.empty();
        }
        try {
            JsonNode claims = json.readTree(Base64.getUrlDecoder().decode(parts[1]));
            JsonNode issuer = claims.get("iss");
            return issuer != null && issuer.isTextual() ? Optional.of(issuer.asText()) : Optional.empty();
        } catch (IllegalArgumentException | IOException _) {
            return Optional.empty();
        }
    }
}
