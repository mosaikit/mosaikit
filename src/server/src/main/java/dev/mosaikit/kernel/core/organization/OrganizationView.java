// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Public representation of an organization. {@code initialAdministrator} is present only in the
 * answer that created the realm of the organization; {@code suspension} only while a platform
 * administrator suspended it (MK-072).
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
        @JsonInclude(JsonInclude.Include.NON_NULL) InitialAdministrator initialAdministrator,
        boolean suspended,
        @JsonInclude(JsonInclude.Include.NON_NULL) Suspension suspension) {

    /**
     * The suspension of an organization (MK-072).
     *
     * @param at when it was suspended
     * @param by the username of the platform administrator who suspended it
     * @param reason why, as they wrote it, or {@code null}
     */
    public record Suspension(Instant at, String by, String reason) {}

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
                initialAdministrator,
                organization.isSuspended(),
                organization
                        .getSuspendedAt()
                        .map(at -> new Suspension(
                                at,
                                organization.getSuspendedBy().orElse(null),
                                organization.getSuspensionReason().orElse(null)))
                        .orElse(null));
    }
}
