// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import dev.mosaikit.kernel.core.organization.SignInPolicy;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * How an organization signs in.
 *
 * @param id identifier of the organization
 * @param slug slug of the organization, also its sub-domain
 * @param realm Keycloak realm; empty when the organization uses local accounts only
 * @param emailDomains lowercase email domains that belong to the organization
 * @param signIn how its members sign in to act on its data (MK-017)
 */
public record OrganizationIdentity(
        UUID id, String slug, Optional<String> realm, Set<String> emailDomains, SignInPolicy signIn) {

    public OrganizationIdentity {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(slug, "slug");
        Objects.requireNonNull(realm, "realm");
        emailDomains = Set.copyOf(emailDomains);
        Objects.requireNonNull(signIn, "signIn");
    }

    /** An organization whose members sign in with a password, and also through its realm when it has one. */
    public OrganizationIdentity(UUID id, String slug, Optional<String> realm, Set<String> emailDomains) {
        this(id, slug, realm, emailDomains, realm.isPresent() ? SignInPolicy.PASSWORD_OR_REALM : SignInPolicy.PASSWORD);
    }

    /** Whether people can sign in through the realm of the organization. */
    public boolean federated() {
        return realm.isPresent() && signIn.allowsRealm();
    }
}
