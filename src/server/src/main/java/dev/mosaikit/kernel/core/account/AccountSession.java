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
 * A session of a person, kept by the kernel (MK-125): the session of the shell opened with a password,
 * whose cookie is kept as a digest, or the session of the realm of an organization, kept as the digest
 * of its issuer and {@code sid}. Ending it refuses its cookie, or the tokens of the realm session, at
 * once.
 */
@Entity
@Table(name = "account_session")
public class AccountSession {

    /** The kind of a session opened with a password, through the cookie of the shell. */
    public static final String PASSWORD = "password";

    /** The kind of a session of the realm of an organization. */
    public static final String REALM = "realm";

    @Id
    private UUID id;

    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    @Column(name = "organization_id")
    private UUID organizationId;

    @Column(name = "token_digest", nullable = false, updatable = false)
    private String tokenDigest;

    @Column(nullable = false, updatable = false)
    private String kind;

    @Column(name = "user_agent", updatable = false)
    private String userAgent;

    @Column(updatable = false)
    private String address;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "last_seen_at", nullable = false)
    private Instant lastSeenAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "ended_at")
    private Instant endedAt;

    /** Required by JPA. */
    protected AccountSession() {}

    AccountSession(
            UUID accountId,
            UUID organizationId,
            String tokenDigest,
            String kind,
            SessionClient client,
            Instant now,
            Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.accountId = Objects.requireNonNull(accountId, "accountId");
        this.organizationId = organizationId;
        this.tokenDigest = Objects.requireNonNull(tokenDigest, "tokenDigest");
        this.kind = Objects.requireNonNull(kind, "kind");
        this.userAgent = client.userAgent();
        this.address = client.address();
        this.createdAt = now;
        this.lastSeenAt = now;
        this.expiresAt = Objects.requireNonNull(expiresAt, "expiresAt");
    }

    public UUID getId() {
        return id;
    }

    public UUID getAccountId() {
        return accountId;
    }

    public Optional<UUID> getOrganizationId() {
        return Optional.ofNullable(organizationId);
    }

    public String getKind() {
        return kind;
    }

    public Optional<String> getUserAgent() {
        return Optional.ofNullable(userAgent);
    }

    public Optional<String> getAddress() {
        return Optional.ofNullable(address);
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getLastSeenAt() {
        return lastSeenAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Optional<Instant> getEndedAt() {
        return Optional.ofNullable(endedAt);
    }
}
