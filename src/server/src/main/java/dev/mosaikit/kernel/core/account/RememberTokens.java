// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of the "remember me" tokens. */
@Repository
public interface RememberTokens {

    @Find
    Optional<RememberToken> findByTokenDigest(String tokenDigest);

    @Insert
    void insert(RememberToken token);

    @Query("delete from RememberToken t where t.tokenDigest = :tokenDigest")
    int deleteByTokenDigest(String tokenDigest);

    /** Revokes the tokens asked for in a session, when it ends (MK-125). */
    @Query("delete from RememberToken t where t.sessionId = :sessionId")
    int deleteBySessionId(UUID sessionId);

    /** Revokes every token of an account, when it is suspended (MK-125). */
    @Query("delete from RememberToken t where t.accountId = :accountId")
    int deleteByAccountId(UUID accountId);

    /**
     * Revokes the tokens of an account whose session ended, or that belong to no session (issued
     * before MK-125), when the account leaves an organization.
     */
    @Query("delete from RememberToken t where t.accountId = :accountId and (t.sessionId is null"
            + " or t.sessionId in (select s.id from AccountSession s where s.endedAt is not null))")
    int deleteOfEndedSessions(UUID accountId);

    /** Moves a token to the session it opened when its previous one ended by itself. */
    @Query("update RememberToken t set t.sessionId = :sessionId where t.id = :id")
    int moveToSession(UUID id, UUID sessionId);

    @Query("delete from RememberToken t where t.expiresAt <= :now")
    int deleteExpired(Instant now);
}
