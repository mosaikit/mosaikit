// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of the drafts of tools. */
@Repository
public interface ActionDrafts {

    @Find
    Optional<ActionDraft> findById(UUID id);

    @Query("""
            from ActionDraft d
            where d.username = :username and d.organizationId = :organizationId
              and d.status = :status and d.expiresAt > :now
            order by d.createdAt""")
    List<ActionDraft> findOpen(String username, UUID organizationId, ActionDraft.Status status, Instant now);

    @Insert
    void insert(ActionDraft draft);

    @Update
    void update(ActionDraft draft);
}
