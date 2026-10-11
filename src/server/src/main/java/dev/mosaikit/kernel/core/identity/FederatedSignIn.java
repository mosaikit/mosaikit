// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * A person signed in through the realm of an organization, as stated by a verified token.
 *
 * @param organizationId organization of the realm
 * @param subject subject ({@code sub}) of the person in the realm
 * @param email email address stated by the realm
 * @param emailVerified whether the realm verified the email address
 * @param displayName name to show
 * @param roles kernel roles granted by the realm
 */
public record FederatedSignIn(
        UUID organizationId,
        String subject,
        String email,
        boolean emailVerified,
        String displayName,
        Set<String> roles) {

    public FederatedSignIn {
        Objects.requireNonNull(organizationId, "organizationId");
        Objects.requireNonNull(subject, "subject");
        Objects.requireNonNull(email, "email");
        Objects.requireNonNull(displayName, "displayName");
        roles = Set.copyOf(roles);
    }
}
