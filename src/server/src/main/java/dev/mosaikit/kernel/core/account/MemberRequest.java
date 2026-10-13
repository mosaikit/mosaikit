// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Set;

/**
 * Roles of a person in an organization (MK-017).
 *
 * @param roles {@code organization-user} and, for managers, {@code organization-admin}; by default
 *     {@code organization-user}
 * @param displayName name of a person who has no account yet
 */
public record MemberRequest(
        @Size(max = 2) Set<@NotBlank String> roles,
        @Size(max = 120) String displayName) {}
