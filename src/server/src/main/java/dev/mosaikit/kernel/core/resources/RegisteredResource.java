// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.resources;

import dev.mosaikit.kernel.api.resource.ResourceRef;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** The entry of a resource of an extension in the registry of the kernel (MK-054). */
@Entity
@Table(name = "resource")
public class RegisteredResource {

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    @Column(name = "extension_id", nullable = false, updatable = false)
    private String extensionId;

    @Column(name = "type", nullable = false, updatable = false)
    private String resourceType;

    @Column(name = "ref_id", nullable = false, updatable = false)
    private String refId;

    /** The person who owns the resource, or {@code null} when the organization owns it. */
    @Column(name = "owner_id", updatable = false)
    private UUID ownerId;

    @Column(nullable = false)
    private String title;

    @Column(nullable = false)
    private String link;

    @Column(name = "parent_id")
    private UUID parentId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** Required by JPA. */
    protected RegisteredResource() {}

    public RegisteredResource(
            UUID organizationId, ResourceRef ref, UUID ownerId, String title, String link, UUID parentId, Instant now) {
        this.id = UUID.randomUUID();
        this.organizationId = organizationId;
        this.extensionId = ref.extension();
        this.resourceType = ref.type();
        this.refId = ref.id();
        this.ownerId = ownerId;
        this.title = title;
        this.link = link;
        this.parentId = parentId;
        this.createdAt = now;
        this.updatedAt = now;
    }

    /** Changes what the extension says about the resource; the owner stays. */
    public void change(String title, String link, UUID parentId, Instant now) {
        this.title = title;
        this.link = link;
        this.parentId = parentId;
        this.updatedAt = now;
    }

    public ResourceRef ref() {
        return new ResourceRef(extensionId, resourceType, refId);
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public String getExtensionId() {
        return extensionId;
    }

    public String getResourceType() {
        return resourceType;
    }

    public String getRefId() {
        return refId;
    }

    public UUID getOwnerId() {
        return ownerId;
    }

    public String getTitle() {
        return title;
    }

    public String getLink() {
        return link;
    }

    public UUID getParentId() {
        return parentId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
