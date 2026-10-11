// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.documents;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.UUID;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** A JSON document of a plugin, in one of the collections of its manifest (ADR-0031). */
@Entity
@Table(name = "plugin_document")
public class PluginDocument {

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    @Column(name = "plugin_id", nullable = false, updatable = false)
    private String pluginId;

    @Column(nullable = false, updatable = false)
    private String collection;

    /** The team the document is shared with, or {@code null} for the whole organization (MK-032). */
    @Column(name = "team_id", updatable = false)
    private UUID teamId;

    /** The document, as JSON text. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String data;

    @Version
    @Column(nullable = false)
    private int version;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "created_by", nullable = false, updatable = false)
    private String createdBy;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "updated_by", nullable = false)
    private String updatedBy;

    /** Required by JPA. */
    protected PluginDocument() {}

    public PluginDocument(
            UUID organizationId,
            String pluginId,
            String collection,
            UUID teamId,
            String data,
            String author,
            Instant now) {
        this.id = UUID.randomUUID();
        this.teamId = teamId;
        this.organizationId = organizationId;
        this.pluginId = pluginId;
        this.collection = collection;
        this.data = data;
        this.createdAt = now;
        this.createdBy = author;
        this.updatedAt = now;
        this.updatedBy = author;
    }

    /** Replaces the content of the document. */
    void replace(String data, String author, Instant now) {
        this.data = data;
        this.updatedAt = now;
        this.updatedBy = author;
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public String getPluginId() {
        return pluginId;
    }

    public String getCollection() {
        return collection;
    }

    public UUID getTeamId() {
        return teamId;
    }

    public String getData() {
        return data;
    }

    public int getVersion() {
        return version;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public String getCreatedBy() {
        return createdBy;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public String getUpdatedBy() {
        return updatedBy;
    }
}
