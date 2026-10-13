// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.service;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * A key of a service identity (MK-124), sent as {@code Authorization: Bearer mks_...}. The secret is
 * kept only as a digest; its first characters, the prefix, tell keys apart. An identity has at most
 * two live keys, so that a key can be rotated without a pause.
 */
@Entity
@Table(name = "service_key")
public class ServiceKey {

    @Id
    private UUID id;

    @Column(name = "service_id", nullable = false, updatable = false)
    private UUID serviceId;

    @Column(nullable = false, updatable = false)
    private String prefix;

    @Column(name = "token_digest", nullable = false, updatable = false)
    private String tokenDigest;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "last_used_at")
    private Instant lastUsedAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    /** Required by JPA. */
    protected ServiceKey() {}

    ServiceKey(UUID serviceId, String prefix, String tokenDigest, Instant now) {
        this.id = UUID.randomUUID();
        this.serviceId = Objects.requireNonNull(serviceId, "serviceId");
        this.prefix = Objects.requireNonNull(prefix, "prefix");
        this.tokenDigest = Objects.requireNonNull(tokenDigest, "tokenDigest");
        this.createdAt = now;
    }

    public UUID getId() {
        return id;
    }

    public UUID getServiceId() {
        return serviceId;
    }

    public String getPrefix() {
        return prefix;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Optional<Instant> getLastUsedAt() {
        return Optional.ofNullable(lastUsedAt);
    }

    public Optional<Instant> getRevokedAt() {
        return Optional.ofNullable(revokedAt);
    }
}
