// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of accounts. The implementation is generated at build time. */
@Repository
public interface UserAccounts {

    @Find
    Optional<UserAccount> findByUsername(String username);

    @Find
    Optional<UserAccount> findById(UUID id);

    @Query("select count(a) from UserAccount a")
    long countAll();

    @Query("select count(a) from UserAccount a where a.username = :username")
    long countByUsername(String username);

    @Insert
    void insert(UserAccount account);

    @Update
    void update(UserAccount account);
}
