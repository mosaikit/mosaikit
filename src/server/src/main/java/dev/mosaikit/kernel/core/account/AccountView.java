// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.organization.SignInPolicy;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Public representation of an account. It never exposes credentials.
 *
 * @param roles the roles of the current request: those of the platform when signed in with a
 *     password, and those in the organization of the request
 * @param organizationId the organization the request acts on, or {@code null}
 * @param organization the slug of that organization, or {@code null}
 * @param memberships every organization of the person (MK-017)
 */
public record AccountView(
        UUID id,
        String username,
        String displayName,
        Set<String> roles,
        UUID organizationId,
        String organization,
        List<MembershipView> memberships,
        Preferences preferences) {

    /**
     * An organization of the person.
     *
     * @param signIn how its members sign in: an organization that requires its realm cannot be used
     *     after signing in with a password
     */
    public record MembershipView(
            UUID organizationId, String slug, String name, Set<String> roles, SignInPolicy signIn) {}
}
