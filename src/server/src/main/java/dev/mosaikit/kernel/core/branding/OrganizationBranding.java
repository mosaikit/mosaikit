// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.branding;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** The branding of an organization (MK-074): its display name, accent color and theme tokens. */
@Entity
@Table(name = "organization_branding")
public class OrganizationBranding {

    @Id
    @Column(name = "organization_id")
    private UUID organizationId;

    @Column(name = "display_name")
    private String displayName;

    private String accent;

    /** The tokens of the theme changed, as JSON. */
    @Column(nullable = false)
    private String tokens;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    /** Required by JPA. */
    protected OrganizationBranding() {}

    public OrganizationBranding(UUID organizationId) {
        this.organizationId = organizationId;
        this.tokens = "{}";
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getAccent() {
        return accent;
    }

    public String getTokens() {
        return tokens;
    }

    void change(String displayName, String accent, String tokens, Instant now) {
        this.displayName = displayName;
        this.accent = accent;
        this.tokens = tokens;
        this.updatedAt = now;
    }
}
