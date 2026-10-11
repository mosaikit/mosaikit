// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.Objects;
import java.util.UUID;

/**
 * An email domain that belongs to an organization. People who sign in with an address of the
 * domain are sent to the identity provider of the organization (MK-012).
 */
@Entity
@Table(name = "organization_email_domain")
public class EmailDomain {

    /**
     * A domain name such as {@code example.org}: labels of letters, digits and hyphens, a
     * top-level domain of letters. Possessive quantifiers keep the match linear.
     */
    public static final String NAME_PATTERN =
            "^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)++[a-zA-Z]{2,63}$";

    /** Lowercase domain, for example {@code example.org}. */
    @Id
    @Column(length = 253)
    private String domain;

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    /** Required by JPA. */
    protected EmailDomain() {}

    public EmailDomain(String domain, UUID organizationId) {
        this.domain = Objects.requireNonNull(domain, "domain");
        this.organizationId = Objects.requireNonNull(organizationId, "organizationId");
    }

    public String getDomain() {
        return domain;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }
}
