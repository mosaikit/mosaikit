// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

/**
 * Request to create an organization.
 *
 * @param slug URL-safe identifier, also used as sub-domain
 * @param name display name
 * @param selfRegistration whether people can create their own account in the organization
 * @param federation when present, the kernel also creates the Keycloak realm of the organization
 *     (MK-018)
 * @param signIn how members sign in (MK-017); by default through the realm when the organization is
 *     created with one, otherwise with a password
 */
public record CreateOrganizationRequest(
        @NotBlank
        @Size(min = 2, max = 63)
        @Pattern(
                regexp = "^[a-z0-9]([a-z0-9-]*[a-z0-9])?$",
                message = "use lowercase letters, digits and inner hyphens")
        String slug,

        @NotBlank @Size(max = 120) String name,
        boolean selfRegistration,
        @Valid FederationRequest federation,
        SignInPolicy signIn) {}
