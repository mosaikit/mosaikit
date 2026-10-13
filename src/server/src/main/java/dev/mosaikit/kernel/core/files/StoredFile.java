// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** What the kernel knows of a file of an extension (MK-041); the content is in the {@link FileStore}. */
@Entity
@Table(name = "stored_file")
public class StoredFile {

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    @Column(name = "extension_id", nullable = false, updatable = false)
    private String extensionId;

    /** The person who stored the file, or {@code null}. */
    @Column(name = "owner_id", updatable = false)
    private UUID ownerId;

    /** The team the file is shared with, or {@code null} for a file of the organization. */
    @Column(name = "team_id", updatable = false)
    private UUID teamId;

    @Column(nullable = false)
    private String name;

    @Column(name = "content_type", nullable = false)
    private String contentType;

    @Column(nullable = false)
    private long size;

    @Column(nullable = false)
    private String checksum;

    @Column(name = "storage_key", nullable = false, updatable = false)
    private String storageKey;

    @Column(name = "resource_id")
    private UUID resourceId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** Required by JPA. */
    protected StoredFile() {}

    @SuppressWarnings("java:S107") // the columns of the table
    public StoredFile(
            UUID id,
            UUID organizationId,
            String extensionId,
            UUID ownerId,
            UUID teamId,
            String name,
            String contentType,
            long size,
            String checksum,
            UUID resourceId,
            Instant now) {
        this.id = id;
        this.organizationId = organizationId;
        this.extensionId = extensionId;
        this.ownerId = ownerId;
        this.teamId = teamId;
        this.name = name;
        this.contentType = contentType;
        this.size = size;
        this.checksum = checksum;
        this.storageKey = FileStore.key(organizationId, extensionId, id);
        this.resourceId = resourceId;
        this.createdAt = now;
        this.updatedAt = now;
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

    public UUID getOwnerId() {
        return ownerId;
    }

    public UUID getTeamId() {
        return teamId;
    }

    public String getName() {
        return name;
    }

    public String getContentType() {
        return contentType;
    }

    public long getSize() {
        return size;
    }

    public String getChecksum() {
        return checksum;
    }

    public String getStorageKey() {
        return storageKey;
    }

    public UUID getResourceId() {
        return resourceId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
