// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.favorites;

import jakarta.data.repository.Delete;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Jakarta Data repository of the favorites. Row-level security already limits the rows to the
 * organization of the request; the queries name it too, as every query of the kernel does.
 */
@Repository
public interface FavoriteRepository {

    @Query("""
            from Favorite f
            where f.organizationId = :organizationId and f.accountId = :accountId
            order by f.createdAt desc, f.id""")
    List<Favorite> of(UUID organizationId, UUID accountId);

    @Query("""
            from Favorite f
            where f.organizationId = :organizationId and f.accountId = :accountId
              and f.extensionId = :extensionId and f.resourceType = :resourceType and f.refId = :refId""")
    Optional<Favorite> find(UUID organizationId, UUID accountId, String extensionId, String resourceType, String refId);

    @Query("select count(f) from Favorite f where f.organizationId = :organizationId and f.accountId = :accountId")
    long count(UUID organizationId, UUID accountId);

    @Insert
    void insert(Favorite favorite);

    @Update
    void update(Favorite favorite);

    @Delete
    void delete(Favorite favorite);
}
