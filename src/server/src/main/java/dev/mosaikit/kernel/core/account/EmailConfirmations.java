// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of the confirmation links. */
@Repository
public interface EmailConfirmations {

    @Find
    Optional<EmailConfirmation> findByTokenDigest(String tokenDigest);

    @Insert
    void insert(EmailConfirmation confirmation);

    @Query("delete from EmailConfirmation c where c.accountId = :accountId")
    int deleteByAccountId(UUID accountId);
}
