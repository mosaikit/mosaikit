// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import java.util.Set;

/**
 * A local account that an administrator creates for a person (MK-048), who then sets the password
 * with a link.
 *
 * @param email email address, used as login name
 * @param displayName name shown to other members
 * @param roles {@code organization-user} and, for managers, {@code organization-admin}; by default
 *     {@code organization-user}
 */
public record NewAccountRequest(
        @NotBlank @Email @Size(max = 254) String email,
        @NotBlank @Size(max = 120) String displayName,
        @Size(max = 2) Set<@NotBlank String> roles) {}
