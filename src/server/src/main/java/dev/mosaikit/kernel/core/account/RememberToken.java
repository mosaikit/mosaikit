// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/** A "remember me" token of an account, kept as the digest of the value of its cookie. */
@Entity
@Table(name = "remember_token")
public class RememberToken {

    @Id
    private UUID id;

    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    @Column(name = "token_digest", nullable = false, updatable = false)
    private String tokenDigest;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false, updatable = false)
    private Instant expiresAt;

    /** Required by JPA. */
    protected RememberToken() {}

    public RememberToken(UUID accountId, String tokenDigest, Instant createdAt, Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.accountId = accountId;
        this.tokenDigest = tokenDigest;
        this.createdAt = createdAt;
        this.expiresAt = expiresAt;
    }

    public UUID getAccountId() {
        return accountId;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }
}
