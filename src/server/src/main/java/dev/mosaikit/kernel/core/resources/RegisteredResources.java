// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.resources;

import jakarta.data.repository.Delete;
import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Jakarta Data repository of the registry of resources. Row-level security already limits the rows to
 * the organization of the request; the queries name it too, as every query of the kernel does.
 */
@Repository
public interface RegisteredResources {

    @Find
    Optional<RegisteredResource> findById(UUID id);

    @Query("""
            from RegisteredResource r
            where r.organizationId = :organizationId and r.extensionId = :extensionId
              and r.resourceType = :resourceType and r.refId = :refId""")
    Optional<RegisteredResource> find(UUID organizationId, String extensionId, String resourceType, String refId);

    @Query("""
            from RegisteredResource r
            where r.organizationId = :organizationId and r.extensionId = :extensionId
              and r.resourceType = :resourceType
            order by r.title, r.refId""")
    List<RegisteredResource> list(UUID organizationId, String extensionId, String resourceType);

    @Query("""
            from RegisteredResource r
            where r.organizationId = :organizationId and r.extensionId = :extensionId
              and r.resourceType = :resourceType and r.ownerId = :ownerId
            order by r.title, r.refId""")
    List<RegisteredResource> listOwnedBy(UUID organizationId, String extensionId, String resourceType, UUID ownerId);

    @Query("from RegisteredResource r where r.organizationId = :organizationId and r.id in :ids")
    List<RegisteredResource> findByIds(UUID organizationId, List<UUID> ids);

    @Insert
    void insert(RegisteredResource resource);

    @Update
    void update(RegisteredResource resource);

    @Delete
    void delete(RegisteredResource resource);

    /** Removes the entries of every organization whose extension is not among those given. */
    @Query("delete from RegisteredResource r where r.extensionId not in :installed")
    int deleteAllExcept(List<String> installed);

    /** Removes the entries of every organization. */
    @Query("delete from RegisteredResource r")
    int deleteAll();
}
