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

/** Jakarta Data repository of the sessions of people (MK-125). */
@Repository
public interface AccountSessions {

    @Find
    Optional<AccountSession> findByTokenDigest(String tokenDigest);

    @Find
    Optional<AccountSession> findById(UUID id);

    @Insert
    void insert(AccountSession accountSession);

    /** The sessions of an account that are not ended, live or not: the caller filters the expired ones. */
    @Query("select s from AccountSession s where s.accountId = :accountId and s.endedAt is null"
            + " and s.expiresAt > :now order by s.lastSeenAt desc")
    List<AccountSession> findOpen(UUID accountId, Instant now);

    @Query("update AccountSession s set s.lastSeenAt = :now where s.id = :id")
    int touch(UUID id, Instant now);

    @Query("update AccountSession s set s.lastSeenAt = :now, s.organizationId = :organizationId where s.id = :id")
    int touchIn(UUID id, UUID organizationId, Instant now);

    /** A realm session used again after its record expired: the realm decides how long it lives. */
    @Query("update AccountSession s set s.lastSeenAt = :now, s.expiresAt = :expiresAt where s.id = :id"
            + " and s.endedAt is null")
    int renew(UUID id, Instant now, Instant expiresAt);

    @Query("update AccountSession s set s.endedAt = :now where s.id = :id and s.endedAt is null")
    int end(UUID id, Instant now);

    @Query("update AccountSession s set s.endedAt = :now where s.accountId = :accountId and s.endedAt is null")
    int endAllOf(UUID accountId, Instant now);

    @Query("update AccountSession s set s.endedAt = :now where s.accountId = :accountId and s.endedAt is null"
            + " and (s.organizationId = :organizationId or s.organizationId is null)")
    int endIn(UUID accountId, UUID organizationId, Instant now);

    /**
     * The tokens of an ended realm session may still be refreshed by the realm: its record stays, so
     * that they are refused, at least until then.
     */
    @Query("update AccountSession s set s.expiresAt = :until where s.kind = 'realm' and s.endedAt is not null"
            + " and s.expiresAt < :until and s.accountId = :accountId")
    int keepEndedRealmSessions(UUID accountId, Instant until);

    @Query("update AccountSession s set s.expiresAt = :until where s.id = :id and s.kind = 'realm'"
            + " and s.endedAt is not null and s.expiresAt < :until")
    int keepEndedRealmSession(UUID id, Instant until);

    /**
     * Removes the records past their maximum life, and those of password sessions idle since before
     * {@code idleSince}: their cookies open nothing either way.
     */
    @Query("delete from AccountSession s where s.expiresAt <= :now"
            + " or (s.kind = 'password' and s.endedAt is null and s.lastSeenAt <= :idleSince)")
    int deleteExpired(Instant now, Instant idleSince);
}
