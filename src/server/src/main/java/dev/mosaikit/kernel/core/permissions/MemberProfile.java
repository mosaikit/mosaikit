// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.permissions;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** The profile assigned to a member of an organization (MK-056), instead of the default of their role. */
@Entity
@Table(name = "member_profile")
public class MemberProfile {

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    @Column(name = "profile_id", nullable = false)
    private UUID profileId;

    @Column(name = "assigned_at", nullable = false)
    private Instant assignedAt;

    /** Required by JPA. */
    protected MemberProfile() {}

    public MemberProfile(UUID organizationId, UUID accountId, UUID profileId, Instant now) {
        this.id = UUID.randomUUID();
        this.organizationId = organizationId;
        this.accountId = accountId;
        this.profileId = profileId;
        this.assignedAt = now;
    }

    /** Assigns another profile. */
    public void assign(UUID profileId, Instant now) {
        this.profileId = profileId;
        this.assignedAt = now;
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public UUID getAccountId() {
        return accountId;
    }

    public UUID getProfileId() {
        return profileId;
    }

    public Instant getAssignedAt() {
        return assignedAt;
    }
}
