// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.favorites;

import dev.mosaikit.kernel.api.resource.ResourceRef;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A resource of an extension that a person marked as favorite (MK-094), named by its reference so that
 * it outlives the absence of its extension (MK-135).
 */
@Entity
@Table(name = "favorite")
public class Favorite {

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    @Column(name = "extension_id", nullable = false, updatable = false)
    private String extensionId;

    @Column(name = "type", nullable = false, updatable = false)
    private String resourceType;

    @Column(name = "ref_id", nullable = false, updatable = false)
    private String refId;

    /** The title of the resource when it was last marked, for the placeholder while it is absent. */
    @Column(nullable = false)
    private String title;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    /** Required by JPA. */
    protected Favorite() {}

    public Favorite(UUID organizationId, UUID accountId, ResourceRef ref, String title, Instant now) {
        this.id = UUID.randomUUID();
        this.organizationId = organizationId;
        this.accountId = accountId;
        this.extensionId = ref.extension();
        this.resourceType = ref.type();
        this.refId = ref.id();
        this.title = title;
        this.createdAt = now;
    }

    public ResourceRef ref() {
        return new ResourceRef(extensionId, resourceType, refId);
    }

    public String getTitle() {
        return title;
    }

    public void setTitle(String title) {
        this.title = title;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
