// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Public representation of an organization. {@code initialAdministrator} is present only in the
 * answer that created the realm of the organization.
 */
public record OrganizationView(
        UUID id,
        String slug,
        String name,
        boolean selfRegistration,
        Instant createdAt,
        String identityRealm,
        List<String> emailDomains,
        SignInPolicy signIn,
        @JsonInclude(JsonInclude.Include.NON_NULL) InitialAdministrator initialAdministrator) {

    static OrganizationView of(Organization organization, List<String> emailDomains) {
        return of(organization, emailDomains, null);
    }

    static OrganizationView of(
            Organization organization, List<String> emailDomains, InitialAdministrator initialAdministrator) {
        return new OrganizationView(
                organization.getId(),
                organization.getSlug(),
                organization.getName(),
                organization.isSelfRegistration(),
                organization.getCreatedAt(),
                organization.getIdentityRealm().orElse(null),
                emailDomains.stream().sorted().toList(),
                organization.getSignIn(),
                initialAdministrator);
    }
}
