// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import dev.mosaikit.kernel.api.extension.SubjectKind;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A registered resource shared with a subject at a level (MK-055). A link keeps only the SHA-256 of
 * its secret, and stays after it is revoked, so that it answers not found.
 */
@Entity
@Table(name = "resource_grant")
public class ResourceGrant {

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    @Column(name = "resource_id", nullable = false, updatable = false)
    private UUID resourceId;

    /** {@link SubjectKind#value()}. */
    @Column(name = "subject_kind", nullable = false, updatable = false)
    private String subjectKind;

    @Column(name = "account_id", updatable = false)
    private UUID accountId;

    @Column(name = "team_id", updatable = false)
    private UUID teamId;

    @Column(nullable = false)
    private String level;

    @Column(name = "granted_by", nullable = false)
    private UUID grantedBy;

    @Column(name = "granted_at", nullable = false)
    private Instant grantedAt;

    @Column(name = "token_digest", updatable = false)
    private String tokenDigest;

    @Column(name = "expires_at", updatable = false)
    private Instant expiresAt;

    @Column(name = "password_hash", updatable = false)
    private String passwordHash;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    /** Required by JPA. */
    protected ResourceGrant() {}

    private ResourceGrant(
            UUID organizationId,
            UUID resourceId,
            SubjectKind kind,
            UUID accountId,
            UUID teamId,
            String level,
            UUID grantedBy,
            Instant now) {
        this.id = UUID.randomUUID();
        this.organizationId = organizationId;
        this.resourceId = resourceId;
        this.subjectKind = kind.value();
        this.accountId = accountId;
        this.teamId = teamId;
        this.level = level;
        this.grantedBy = grantedBy;
        this.grantedAt = now;
    }

    /** A grant to a person, a group, the organization or the public. */
    static ResourceGrant of(
            UUID organizationId,
            UUID resourceId,
            SubjectKind kind,
            UUID accountId,
            UUID teamId,
            String level,
            UUID grantedBy,
            Instant now) {
        if (kind == SubjectKind.LINK) {
            throw new IllegalArgumentException("a link is made with link()");
        }
        return new ResourceGrant(organizationId, resourceId, kind, accountId, teamId, level, grantedBy, now);
    }

    /** A link, of which only the digest of the secret and the hash of the password are kept. */
    static ResourceGrant link(
            UUID organizationId,
            UUID resourceId,
            String level,
            UUID grantedBy,
            Instant now,
            String tokenDigest,
            Instant expires,
            String passwordHash) {
        ResourceGrant link =
                new ResourceGrant(organizationId, resourceId, SubjectKind.LINK, null, null, level, grantedBy, now);
        link.tokenDigest = tokenDigest;
        link.expiresAt = expires;
        link.passwordHash = passwordHash;
        return link;
    }

    /** Gives the grant another level, as another person may do; the subject stays. */
    void regrant(String newLevel, UUID by, Instant now) {
        this.level = newLevel;
        this.grantedBy = by;
        this.grantedAt = now;
    }

    void revoke(Instant now) {
        this.revokedAt = now;
    }

    /** Whether the grant gives its level now: always, except for a link expired or revoked. */
    public boolean live(Instant now) {
        return revokedAt == null && (expiresAt == null || now.isBefore(expiresAt));
    }

    public SubjectKind kind() {
        return SubjectKind.fromValue(subjectKind).orElseThrow();
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

    public UUID getAccountId() {
        return accountId;
    }

    public UUID getTeamId() {
        return teamId;
    }

    public String getLevel() {
        return level;
    }

    public UUID getGrantedBy() {
        return grantedBy;
    }

    public Instant getGrantedAt() {
        return grantedAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public boolean hasPassword() {
        return passwordHash != null;
    }

    public Instant getRevokedAt() {
        return revokedAt;
    }
}
