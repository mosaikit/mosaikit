// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.teams;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** A team of an organization (MK-032), or a group of a team, such as a private channel (MK-034). */
@Entity
@Table(name = "team")
public class Team {

    public static final String PUBLIC = "public";
    public static final String PRIVATE = "private";

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    /** The team this group belongs to, or {@code null} for a team of the organization. */
    @Column(name = "parent_id", updatable = false)
    private UUID parentId;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private String description;

    @Column(nullable = false)
    private String visibility;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "created_by", nullable = false, updatable = false)
    private String createdBy;

    /** Required by JPA. */
    protected Team() {}

    public Team(
            UUID organizationId,
            UUID parentId,
            String name,
            String description,
            String visibility,
            String author,
            Instant now) {
        this.id = UUID.randomUUID();
        this.organizationId = organizationId;
        this.parentId = parentId;
        this.name = name;
        this.description = description;
        this.visibility = visibility;
        this.createdAt = now;
        this.createdBy = author;
    }

    void change(String name, String description, String visibility) {
        this.name = name;
        this.description = description;
        this.visibility = visibility;
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public UUID getParentId() {
        return parentId;
    }

    /** Whether this is a group of a team rather than a team of the organization. */
    public boolean isGroup() {
        return parentId != null;
    }

    public String getName() {
        return name;
    }

    public String getDescription() {
        return description;
    }

    public String getVisibility() {
        return visibility;
    }

    public boolean isPublic() {
        return PUBLIC.equals(visibility);
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public String getCreatedBy() {
        return createdBy;
    }
}
