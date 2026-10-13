// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of personal access keys (MK-060). */
@Repository
public interface AccessKeys {

    @Find
    Optional<AccessKey> findByTokenDigest(String tokenDigest);

    @Find
    Optional<AccessKey> findById(UUID id);

    @Insert
    void insert(AccessKey key);

    /** The keys of an account that are not revoked, expired ones included, the newest first. */
    @Query("select k from AccessKey k where k.accountId = :accountId and k.revokedAt is null"
            + " order by k.createdAt desc")
    List<AccessKey> findNotRevoked(UUID accountId);

    @Query("update AccessKey k set k.lastUsedAt = :now where k.id = :id")
    int touch(UUID id, Instant now);

    @Query("update AccessKey k set k.revokedAt = :now where k.id = :id and k.revokedAt is null")
    int revoke(UUID id, Instant now);

    @Query("update AccessKey k set k.revokedAt = :now where k.accountId = :accountId and k.revokedAt is null")
    int revokeAllOf(UUID accountId, Instant now);

    @Query("update AccessKey k set k.revokedAt = :now where k.accountId = :accountId"
            + " and k.organizationId = :organizationId and k.revokedAt is null")
    int revokeIn(UUID accountId, UUID organizationId, Instant now);
}
