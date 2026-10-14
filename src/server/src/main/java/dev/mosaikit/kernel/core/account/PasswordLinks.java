// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of the links that set the password of an account (MK-048). */
@Repository
public interface PasswordLinks {

    @Find
    Optional<PasswordLink> findByTokenDigest(String tokenDigest);

    @Insert
    void insert(PasswordLink link);

    @Query("delete from PasswordLink l where l.accountId = :accountId")
    int deleteByAccountId(UUID accountId);
}
