// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.branding;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * An image of the branding of an organization (MK-074): a logo, the icon or the favicon. Its content
 * is a file of the kernel ({@link dev.mosaikit.kernel.core.files.FileService#KERNEL}).
 */
@Entity
@Table(name = "organization_brand_image")
public class BrandImage {

    @Id
    @Column(name = "file_id")
    private UUID fileId;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    @Column(nullable = false, updatable = false)
    private String kind;

    @Column(name = "content_type", nullable = false, updatable = false)
    private String contentType;

    @Column(nullable = false, updatable = false)
    private long size;

    @Column(nullable = false, updatable = false)
    private String checksum;

    @Column(name = "updated_at", nullable = false, updatable = false)
    private Instant updatedAt;

    /** Required by JPA. */
    protected BrandImage() {}

    public BrandImage(
            UUID fileId,
            UUID organizationId,
            ImageKind kind,
            String contentType,
            long size,
            String checksum,
            Instant now) {
        this.fileId = fileId;
        this.organizationId = organizationId;
        this.kind = kind.id();
        this.contentType = contentType;
        this.size = size;
        this.checksum = checksum;
        this.updatedAt = now;
    }

    public UUID getFileId() {
        return fileId;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public String getKind() {
        return kind;
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

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
