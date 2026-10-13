// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * A personal access key (MK-060): a secret that a script or another client presents instead of a
 * session, acting for its person in one organization. The secret is kept only as a digest; its first
 * characters, the prefix, tell keys apart.
 */
@Entity
@Table(name = "access_key")
public class AccessKey {

    @Id
    private UUID id;

    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    @Column(nullable = false, updatable = false)
    private String name;

    @Column(nullable = false, updatable = false)
    private String prefix;

    @Column(name = "token_digest", nullable = false, updatable = false)
    private String tokenDigest;

    @Column(name = "can_write", nullable = false, updatable = false)
    private boolean canWrite;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    @Column(name = "last_used_at")
    private Instant lastUsedAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    /** Required by JPA. */
    protected AccessKey() {}

    AccessKey(
            UUID accountId,
            UUID organizationId,
            String name,
            String prefix,
            String tokenDigest,
            boolean canWrite,
            Instant now,
            Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.accountId = Objects.requireNonNull(accountId, "accountId");
        this.organizationId = Objects.requireNonNull(organizationId, "organizationId");
        this.name = Objects.requireNonNull(name, "name");
        this.prefix = Objects.requireNonNull(prefix, "prefix");
        this.tokenDigest = Objects.requireNonNull(tokenDigest, "tokenDigest");
        this.canWrite = canWrite;
        this.createdAt = now;
        this.expiresAt = Objects.requireNonNull(expiresAt, "expiresAt");
    }

    public UUID getId() {
        return id;
    }

    public UUID getAccountId() {
        return accountId;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public String getName() {
        return name;
    }

    public String getPrefix() {
        return prefix;
    }

    public boolean canWrite() {
        return canWrite;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Optional<Instant> getLastUsedAt() {
        return Optional.ofNullable(lastUsedAt);
    }

    public Optional<Instant> getRevokedAt() {
        return Optional.ofNullable(revokedAt);
    }

    /** Records a use; the kernel writes it with an update, without loading the key. */
    void markUsed(Instant now) {
        this.lastUsedAt = now;
    }

    /** Revokes the key; the kernel writes it with an update, without loading the key. */
    void markRevoked(Instant now) {
        if (revokedAt == null) {
            this.revokedAt = now;
        }
    }
}
