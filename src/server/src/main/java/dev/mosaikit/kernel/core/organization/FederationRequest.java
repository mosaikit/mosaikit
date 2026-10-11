// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Set;

/**
 * Asks the kernel to create the Keycloak realm of an organization (MK-018). The realm is named
 * after the slug and gets the client of the kernel UI and the {@code organization-admin} role.
 *
 * @param emailDomains email domains of the organization, which choose its realm at sign-in
 * @param administrator first manager of the organization, created in the realm with a temporary
 *     password; optional
 */
public record FederationRequest(
        @NotNull @Size(max = 20)
        Set<
                        @NotNull @Size(max = 253)
                        @Pattern(regexp = EmailDomain.NAME_PATTERN, message = "use a domain name such as example.org")
                        String>
                emailDomains,

        @Valid Administrator administrator) {

    /**
     * The first manager of the organization.
     *
     * @param email email address, also the username in the realm
     * @param firstName first name
     * @param lastName last name
     */
    public record Administrator(
            @NotBlank @Email @Size(max = 254) String email,
            @NotBlank @Size(max = 120) String firstName,
            @NotBlank @Size(max = 120) String lastName) {}
}
