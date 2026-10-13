// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Self-registration of a person in an organization that allows it.
 *
 * @param organization slug of the organization
 * @param email email address, used as login name
 * @param displayName name shown to other members
 * @param password password of at least 12 characters
 */
public record RegistrationRequest(
        @NotBlank String organization,
        @NotBlank @Email @Size(max = 254) String email,
        @NotBlank @Size(max = 120) String displayName,

        @NotBlank @Size(min = 12, max = 128, message = "must be between 12 and 128 characters")
        String password) {

    /** Hides the password from logs and error messages. */
    @Override
    public String toString() {
        return "RegistrationRequest[organization=" + organization + ", email=" + email + "]";
    }
}
