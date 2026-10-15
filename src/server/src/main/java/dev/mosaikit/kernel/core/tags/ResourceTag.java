// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.tags;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** A tag on an entry of the registry of resources (MK-097), stored normalized. */
@Entity
@Table(name = "resource_tag")
public class ResourceTag {

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    @Column(name = "resource_id", nullable = false, updatable = false)
    private UUID resourceId;

    @Column(nullable = false, updatable = false)
    private String tag;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** Required by JPA. */
    protected ResourceTag() {}

    public ResourceTag(UUID organizationId, UUID resourceId, String tag, Instant now) {
        this.id = UUID.randomUUID();
        this.organizationId = organizationId;
        this.resourceId = resourceId;
        this.tag = tag;
        this.createdAt = now;
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public UUID getResourceId() {
        return resourceId;
    }

    public String getTag() {
        return tag;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
