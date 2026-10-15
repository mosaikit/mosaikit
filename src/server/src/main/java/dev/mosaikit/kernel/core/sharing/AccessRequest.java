// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import dev.mosaikit.kernel.api.resource.ResourceRef;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A request of a person for a level on a resource they were refused (MK-058), until someone who may
 * share the resource approves or rejects it. It names the resource by its reference, never by the
 * entry of the registry: it is kept also when no such resource exists.
 */
@Entity
@Table(name = "access_request")
public class AccessRequest {

    /** Waiting for a decision. */
    public static final String PENDING = "pending";
    /** Approved: the level was granted. */
    public static final String APPROVED = "approved";
    /** Rejected. */
    public static final String REJECTED = "rejected";

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    @Column(name = "requester_id", nullable = false, updatable = false)
    private UUID requesterId;

    @Column(name = "extension_id", nullable = false, updatable = false)
    private String extensionId;

    @Column(name = "type", nullable = false, updatable = false)
    private String resourceType;

    @Column(name = "ref_id", nullable = false, updatable = false)
    private String refId;

    @Column(nullable = false)
    private String level;

    @Column(nullable = false)
    private String message;

    @Column(nullable = false)
    private String status;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "decided_by")
    private UUID decidedBy;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "granted_level")
    private String grantedLevel;

    @Column
    private String reason;

    /** Required by JPA. */
    protected AccessRequest() {}

    public AccessRequest(
            UUID organizationId, UUID requesterId, ResourceRef resource, String level, String message, Instant now) {
        this.id = UUID.randomUUID();
        this.organizationId = organizationId;
        this.requesterId = requesterId;
        this.extensionId = resource.extension();
        this.resourceType = resource.type();
        this.refId = resource.id();
        this.level = level;
        this.message = message;
        this.status = PENDING;
        this.createdAt = now;
    }

    /** Asked again while pending: the new level and message take the place of the old ones. */
    public void askAgain(String level, String message, Instant now) {
        this.level = level;
        this.message = message;
        this.createdAt = now;
    }

    public void approve(UUID by, String granted, Instant now) {
        this.status = APPROVED;
        this.decidedBy = by;
        this.decidedAt = now;
        this.grantedLevel = granted;
    }

    public void reject(UUID by, String reason, Instant now) {
        this.status = REJECTED;
        this.decidedBy = by;
        this.decidedAt = now;
        this.reason = reason;
    }

    public ResourceRef ref() {
        return new ResourceRef(extensionId, resourceType, refId);
    }

    public boolean pending() {
        return PENDING.equals(status);
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public UUID getRequesterId() {
        return requesterId;
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

    public String getLevel() {
        return level;
    }

    public String getMessage() {
        return message;
    }

    public String getStatus() {
        return status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public UUID getDecidedBy() {
        return decidedBy;
    }

    public Instant getDecidedAt() {
        return decidedAt;
    }

    public String getGrantedLevel() {
        return grantedLevel;
    }

    public String getReason() {
        return reason;
    }
}
