// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import java.net.URI;
import java.util.Collection;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Chooses the organization, and so the Keycloak realm, of a sign-in (MK-012): from the
 * sub-domain of the request, from the email domain of the person, or from the issuer of a token.
 * Immutable: a new instance is built when the settings of organizations change.
 */
public final class IdentityRouting {

    private final Optional<String> realmsUrl;
    private final Optional<String> domainSuffix;
    private final Map<String, OrganizationIdentity> bySlug = new HashMap<>();
    private final Map<UUID, OrganizationIdentity> byId = new HashMap<>();
    private final Map<String, OrganizationIdentity> byRealm = new HashMap<>();
    private final Map<String, OrganizationIdentity> byEmailDomain = new HashMap<>();

    /**
     * @param keycloakUrl public base URL of Keycloak; without it no organization is federated
     * @param domain domain of the installation, whose sub-domains are organization slugs
     * @param organizations identity settings of every organization
     */
    public IdentityRouting(
            Optional<URI> keycloakUrl, Optional<String> domain, Collection<OrganizationIdentity> organizations) {
        this.realmsUrl = keycloakUrl.map(url -> stripTrailingSlash(url.toString()) + "/realms/");
        this.domainSuffix = domain.map(value -> "." + value.trim().toLowerCase(Locale.ROOT));
        for (var organization : organizations) {
            bySlug.put(organization.slug(), organization);
            byId.put(organization.id(), organization);
            organization.realm().ifPresent(realm -> byRealm.put(realm, organization));
            organization.emailDomains().forEach(emailDomain -> byEmailDomain.put(emailDomain, organization));
        }
    }

    /** Whether federation is configured for the installation. */
    public boolean federationEnabled() {
        return realmsUrl.isPresent();
    }

    /** The organization whose sub-domain is the given host, for example {@code acme.example.org}. */
    public Optional<OrganizationIdentity> byHost(String host) {
        if (host == null || domainSuffix.isEmpty()) {
            return Optional.empty();
        }
        String name = withoutPort(host.trim().toLowerCase(Locale.ROOT));
        String suffix = domainSuffix.get();
        if (!name.endsWith(suffix)) {
            return Optional.empty();
        }
        String label = name.substring(0, name.length() - suffix.length());
        if (label.isEmpty() || label.contains(".")) {
            return Optional.empty();
        }
        return Optional.ofNullable(bySlug.get(label));
    }

    /** The organization that owns the domain of the given email address. */
    public Optional<OrganizationIdentity> byEmail(String email) {
        if (email == null) {
            return Optional.empty();
        }
        String address = email.trim().toLowerCase(Locale.ROOT);
        int at = address.lastIndexOf('@');
        if (at < 1 || at == address.length() - 1) {
            return Optional.empty();
        }
        return Optional.ofNullable(byEmailDomain.get(address.substring(at + 1)));
    }

    /** The federated organization whose realm has the given issuer URL. */
    public Optional<OrganizationIdentity> byIssuer(String issuer) {
        if (issuer == null || realmsUrl.isEmpty() || !issuer.startsWith(realmsUrl.get())) {
            return Optional.empty();
        }
        String realm = issuer.substring(realmsUrl.get().length());
        if (realm.isEmpty() || realm.contains("/")) {
            return Optional.empty();
        }
        return Optional.ofNullable(byRealm.get(realm));
    }

    /** The organization with the given identifier. */
    public Optional<OrganizationIdentity> byId(UUID id) {
        return Optional.ofNullable(byId.get(id));
    }

    /** The organization with the given slug. */
    public Optional<OrganizationIdentity> bySlug(String slug) {
        return Optional.ofNullable(bySlug.get(slug));
    }

    /**
     * The issuer URL of the realm of the organization, when the organization signs in through its
     * realm (MK-012, MK-017) and the installation has a Keycloak URL.
     */
    public Optional<String> issuer(OrganizationIdentity organization) {
        Objects.requireNonNull(organization, "organization");
        if (!organization.federated()) {
            return Optional.empty();
        }
        return realmsUrl.flatMap(prefix -> organization.realm().map(realm -> prefix + realm));
    }

    private static String stripTrailingSlash(String value) {
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    private static String withoutPort(String host) {
        if (host.startsWith("[")) {
            return host; // IPv6 literal: never an organization sub-domain.
        }
        int colon = host.indexOf(':');
        return colon < 0 ? host : host.substring(0, colon);
    }
}
