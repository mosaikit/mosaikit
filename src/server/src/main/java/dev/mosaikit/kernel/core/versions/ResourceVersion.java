// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.versions;

import jakarta.persistence.Basic;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** A version of an entry of the registry of resources (MK-096): a snapshot, or a stored file. */
@Entity
@Table(name = "resource_version")
public class ResourceVersion {

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    @Column(name = "resource_id", nullable = false, updatable = false)
    private UUID resourceId;

    @Column(nullable = false, updatable = false)
    private int number;

    /** The person who saved it, or {@code null} for code without a person. */
    @Column(name = "author_id", updatable = false)
    private UUID authorId;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "media_type", nullable = false, updatable = false)
    private String mediaType;

    @Column(nullable = false, updatable = false)
    private long size;

    /** Read only when the version is opened: the lists do not carry it. */
    @Basic(fetch = FetchType.LAZY)
    @Column(updatable = false)
    private byte[] snapshot;

    @Column(name = "file_id", updatable = false)
    private UUID fileId;

    @Column(name = "restored_from", updatable = false)
    private Integer restoredFrom;

    /** Required by JPA. */
    protected ResourceVersion() {}

    public ResourceVersion(
            UUID organizationId,
            UUID resourceId,
            int number,
            UUID authorId,
            Instant createdAt,
            String mediaType,
            long size,
            byte[] snapshot,
            UUID fileId,
            Integer restoredFrom) {
        this.id = UUID.randomUUID();
        this.organizationId = organizationId;
        this.resourceId = resourceId;
        this.number = number;
        this.authorId = authorId;
        this.createdAt = createdAt;
        this.mediaType = mediaType;
        this.size = size;
        this.snapshot = snapshot;
        this.fileId = fileId;
        this.restoredFrom = restoredFrom;
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

    public int getNumber() {
        return number;
    }

    public UUID getAuthorId() {
        return authorId;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public String getMediaType() {
        return mediaType;
    }

    public long getSize() {
        return size;
    }

    public byte[] getSnapshot() {
        return snapshot;
    }

    public UUID getFileId() {
        return fileId;
    }

    public Integer getRestoredFrom() {
        return restoredFrom;
    }
}
