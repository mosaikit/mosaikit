// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

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
 * Jakarta Data repository of the grants of sharing (MK-055). Row-level security already limits the
 * rows to the organization of the request; the queries name it too, as every query of the kernel
 * does.
 */
@Repository
public interface ResourceGrants {

    @Find
    Optional<ResourceGrant> findById(UUID id);

    /** The grants of a resource, revoked links included, oldest first. */
    @Query("""
            from ResourceGrant g
            where g.organizationId = :organizationId and g.resourceId = :resourceId
            order by g.grantedAt, g.id""")
    List<ResourceGrant> of(UUID organizationId, UUID resourceId);

    /** The grants of several resources, for the lists of a type. */
    @Query("""
            from ResourceGrant g
            where g.organizationId = :organizationId and g.resourceId in :resourceIds""")
    List<ResourceGrant> ofAll(UUID organizationId, List<UUID> resourceIds);

    @Insert
    void insert(ResourceGrant grant);

    @Update
    void update(ResourceGrant grant);

    @Delete
    void delete(ResourceGrant grant);
}
