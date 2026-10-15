// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web.embed;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A site on which an organization lets its views be shown in an iframe (MK-100), as an origin in its
 * normal form ({@link EmbedSiteAdministration#normalize}).
 */
@Entity
@Table(name = "embed_site")
public class EmbedSite {

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(nullable = false)
    private String origin;

    @Column(name = "added_at", nullable = false)
    private Instant addedAt;

    @Column(name = "added_by", nullable = false)
    private String addedBy;

    /** Required by JPA. */
    protected EmbedSite() {}

    EmbedSite(UUID organizationId, String origin, String addedBy, Instant addedAt) {
        this.id = UUID.randomUUID();
        this.organizationId = organizationId;
        this.origin = origin;
        this.addedBy = addedBy;
        this.addedAt = addedAt;
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public String getOrigin() {
        return origin;
    }

    public Instant getAddedAt() {
        return addedAt;
    }

    public String getAddedBy() {
        return addedBy;
    }
}
