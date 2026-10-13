// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.permissions;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * A profile of an organization (MK-056): a named set of permissions, kept as {@link PermissionGrant}
 * rows, that its administrators assign to members. A profile may be the default of a role: the
 * members of that role without a profile of their own get it.
 */
@Entity
@Table(name = "permission_profile")
public class PermissionProfile {

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String description;

    @Column(name = "default_for_role")
    private String defaultForRole;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** Required by JPA. */
    protected PermissionProfile() {}

    public PermissionProfile(UUID organizationId, String name, String description, String defaultForRole, Instant now) {
        this.id = UUID.randomUUID();
        this.organizationId = organizationId;
        this.name = name;
        this.description = description;
        this.defaultForRole = defaultForRole;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /** Changes the name, the description and the role the profile is the default of. */
    public void change(String name, String description, String defaultForRole, Instant now) {
        this.name = name;
        this.description = description;
        this.defaultForRole = defaultForRole;
        this.updatedAt = now;
    }

    /** No longer the default of a role. */
    public void notDefault(Instant now) {
        this.defaultForRole = null;
        this.updatedAt = now;
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public String getName() {
        return name;
    }

    public String getDescription() {
        return description;
    }

    public Optional<String> getDefaultForRole() {
        return Optional.ofNullable(defaultForRole);
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
