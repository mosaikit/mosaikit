// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import jakarta.data.repository.Delete;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Jakarta Data repository of the credentials of organizations. Row-level security already limits the
 * rows to the organization of the request; the queries name it too, as every query of the kernel does.
 */
@Repository
public interface StoredSecrets {

    @Query("from StoredSecret s where s.organizationId = :organizationId order by s.name")
    List<StoredSecret> list(UUID organizationId);

    @Query("from StoredSecret s where s.organizationId = :organizationId and s.name = :name")
    Optional<StoredSecret> find(UUID organizationId, String name);

    @Insert
    void insert(StoredSecret secret);

    @Update
    void update(StoredSecret secret);

    @Delete
    void delete(StoredSecret secret);
}
