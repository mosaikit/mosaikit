// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.RequestScoped;
import java.util.Optional;
import java.util.UUID;

/**
 * The organization of the current request, for the kernel and for the Java code of plugins
 * (MK-017): the one chosen at authentication by {@link OrganizationAccess} or by the realm.
 */
@RequestScoped
public class RequestOrganization implements CurrentOrganization {

    private final SecurityIdentity identity;

    public RequestOrganization(SecurityIdentity identity) {
        this.identity = identity;
    }

    /** The organization of a security identity, as set at authentication. */
    public static Optional<UUID> of(SecurityIdentity identity) {
        String value = identity == null ? null : identity.getAttribute(OrganizationAccess.ORGANIZATION_ATTRIBUTE);
        return Optional.ofNullable(value).map(UUID::fromString);
    }

    /** The account of a security identity, as set at authentication (MK-032). */
    public static Optional<UUID> account(SecurityIdentity identity) {
        String value = identity == null ? null : identity.getAttribute(OrganizationAccess.ACCOUNT_ATTRIBUTE);
        return Optional.ofNullable(value).map(UUID::fromString);
    }

    /**
     * Whether a security identity is only a guest of the organization of the request (MK-032): it
     * sees the teams where it was added, and nothing else of the organization.
     */
    public static boolean guest(SecurityIdentity identity) {
        return identity != null
                && identity.hasRole(Roles.ORGANIZATION_GUEST)
                && !identity.hasRole(Roles.ORGANIZATION_USER)
                && !identity.hasRole(Roles.ORGANIZATION_ADMIN);
    }

    /** Whether the person of the request is only a guest of its organization. */
    public boolean guest() {
        return guest(identity);
    }

    @Override
    public Optional<UUID> id() {
        return of(identity);
    }

    @Override
    public Optional<String> slug() {
        return Optional.ofNullable(identity.getAttribute(OrganizationAccess.SLUG_ATTRIBUTE));
    }
}
