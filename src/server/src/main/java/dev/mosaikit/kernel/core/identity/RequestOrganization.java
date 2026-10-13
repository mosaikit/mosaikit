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
 * The organization of the current request, for the kernel and for the Java code of extensions
 * (MK-017): the one chosen at authentication by {@link OrganizationAccess} or by the realm.
 */
@RequestScoped
public class RequestOrganization implements CurrentOrganization {

    private final SecurityIdentity identity;

    /**
     * The organization of the resource whose link opened this request without an account (MK-055),
     * once {@code Sharing} answered that the link gives a level on it; {@code null} before.
     */
    private UUID admitted;

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

    /**
     * Whether a security identity administers the organization of the request (MK-055): it holds
     * every level on the resources of that organization. Being a platform administrator does not
     * count.
     */
    public static boolean administrator(SecurityIdentity identity) {
        return identity != null && of(identity).isPresent() && identity.hasRole(Roles.ORGANIZATION_ADMIN);
    }

    /** Whether the person of the request is only a guest of its organization. */
    public boolean guest() {
        return guest(identity);
    }

    /**
     * Lets a request without an account act on the organization of the resource that its link opens
     * (MK-055), from now on: called by {@code Sharing} when it found that the link gives a level on
     * the resource the extension asked about. Before, such a request has no organization, so that
     * the row-level security shows it no row: a route of an extension that never asks
     * {@code Sharing} reads nothing for a link. A request of a person keeps its own organization.
     *
     * @return whether the request acts on that organization now
     */
    public boolean admitLink(UUID organization) {
        if (of(identity).isPresent() || (identity != null && !identity.isAnonymous())) {
            return false;
        }
        if (admitted != null && !admitted.equals(organization)) {
            return false;
        }
        admitted = organization;
        return true;
    }

    /** Takes back {@link #admitLink}: the request has no organization again. */
    public void forgetLink() {
        admitted = null;
    }

    /** Whether the request is one without an account admitted on the organization of its link. */
    public boolean admittedByLink() {
        return admitted != null && of(identity).isEmpty();
    }

    @Override
    public Optional<UUID> id() {
        return of(identity).or(() -> Optional.ofNullable(admitted));
    }

    @Override
    public Optional<String> slug() {
        return Optional.ofNullable(identity.getAttribute(OrganizationAccess.SLUG_ATTRIBUTE));
    }
}
