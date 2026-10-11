// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.time.Instant;
import java.util.Optional;

/** Jakarta Data repository of the "remember me" tokens. */
@Repository
public interface RememberTokens {

    @Find
    Optional<RememberToken> findByTokenDigest(String tokenDigest);

    @Insert
    void insert(RememberToken token);

    @Query("delete from RememberToken t where t.tokenDigest = :tokenDigest")
    int deleteByTokenDigest(String tokenDigest);

    @Query("delete from RememberToken t where t.expiresAt <= :now")
    int deleteExpired(Instant now);
}
