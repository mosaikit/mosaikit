// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Set;

/**
 * How an organization signs in (MK-012).
 *
 * @param realm Keycloak realm of the organization, or {@code null} for local accounts only
 * @param emailDomains email domains of the organization, used to choose its realm at sign-in
 * @param signIn how members sign in (MK-017); when absent, unchanged, and {@code password} when
 *     the realm is removed
 */
public record UpdateIdentityRequest(
        @Size(max = 63)
        @Pattern(
                regexp = "^[A-Za-z0-9][A-Za-z0-9._-]*$",
                message = "use letters, digits, dots, underscores and hyphens")
        String realm,

        @NotNull @Size(max = 20)
        Set<
                        @NotNull @Size(max = 253)
                        @Pattern(regexp = EmailDomain.NAME_PATTERN, message = "use a domain name such as example.org")
                        String>
                emailDomains,

        SignInPolicy signIn) {}
