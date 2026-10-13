// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.fixture.notes;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of memos; the row-level security keeps each organization to its own. */
@Repository
public interface Memos {

    @Find
    Optional<Memo> findById(UUID id);

    /** The memos with these identifiers, oldest first. */
    @Query("from Memo m where m.id in :ids order by m.createdAt")
    List<Memo> findByIds(Collection<UUID> ids);

    @Insert
    void insert(Memo memo);

    @Update
    void update(Memo memo);
}
