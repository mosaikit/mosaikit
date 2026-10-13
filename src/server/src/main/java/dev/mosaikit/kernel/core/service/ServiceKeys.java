// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.service;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of the keys of service identities (MK-124). */
@Repository
public interface ServiceKeys {

    @Find
    Optional<ServiceKey> findByTokenDigest(String tokenDigest);

    @Insert
    void insert(ServiceKey key);

    /** The keys not revoked, the newest first. */
    @Query("select k from ServiceKey k where k.revokedAt is null order by k.createdAt desc")
    List<ServiceKey> findLive();

    /** The keys of an identity not revoked, the newest first. */
    @Query("select k from ServiceKey k where k.serviceId = :serviceId and k.revokedAt is null"
            + " order by k.createdAt desc")
    List<ServiceKey> findLiveOf(UUID serviceId);

    @Query("update ServiceKey k set k.lastUsedAt = :now where k.id = :id")
    int touch(UUID id, Instant now);

    @Query("update ServiceKey k set k.revokedAt = :now where k.id = :id and k.serviceId = :serviceId"
            + " and k.revokedAt is null")
    int revoke(UUID serviceId, UUID id, Instant now);
}
