// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * A link that sets the password of an account an administrator created (MK-048), kept as the digest
 * of its token.
 */
@Entity
@Table(name = "password_link")
public class PasswordLink {

    @Id
    private UUID id;

    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    @Column(name = "organization_id", updatable = false)
    private UUID organizationId;

    @Column(name = "token_digest", nullable = false, updatable = false)
    private String tokenDigest;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    /** Required by JPA. */
    protected PasswordLink() {}

    public PasswordLink(UUID accountId, UUID organizationId, String tokenDigest, Instant createdAt, Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.accountId = accountId;
        this.organizationId = organizationId;
        this.tokenDigest = tokenDigest;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
    }

    public UUID getAccountId() {
        return accountId;
    }

    /** The organization the account was created in. */
    public Optional<UUID> getOrganizationId() {
        return Optional.ofNullable(organizationId);
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }
}
