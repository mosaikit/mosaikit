// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * Roles of a person in an organization (MK-017), and, when the administrators of the organization
 * invite them, their profile and teams (MK-056).
 *
 * @param roles {@code organization-user} and, for managers, {@code organization-admin}; by default
 *     {@code organization-user}
 * @param displayName name of a person who has no account yet
 * @param profile the profile of permissions to assign; {@code null} keeps the one they have, or the
 *     default profile of members
 * @param teams the teams to add the person to, as a member; {@code null} or empty adds none
 */
public record MemberRequest(
        @Size(max = 2) Set<@NotBlank String> roles,
        @Size(max = 120) String displayName,
        UUID profile,
        @Size(max = 100) List<@NotNull UUID> teams) {

    public MemberRequest(Set<String> roles, String displayName) {
        this(roles, displayName, null, null);
    }
}
