// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.versions;

import jakarta.data.repository.Delete;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Jakarta Data repository of the versions of resources (MK-096). Row-level security already limits
 * the rows to the organization of the request; the queries name it too, as every query of the kernel
 * does.
 */
@Repository
public interface ResourceVersions {

    /** The versions of a resource, newest first. */
    @Query("""
            from ResourceVersion v
            where v.organizationId = :organizationId and v.resourceId = :resourceId
            order by v.number desc""")
    List<ResourceVersion> of(UUID organizationId, UUID resourceId);

    /** A version of a resource. */
    @Query("""
            from ResourceVersion v
            where v.organizationId = :organizationId and v.resourceId = :resourceId and v.id = :id""")
    Optional<ResourceVersion> find(UUID organizationId, UUID resourceId, UUID id);

    /** The highest number of the versions of a resource, 0 when it has none. */
    @Query("""
            select coalesce(max(v.number), 0) from ResourceVersion v
            where v.organizationId = :organizationId and v.resourceId = :resourceId""")
    int newest(UUID organizationId, UUID resourceId);

    @Insert
    void insert(ResourceVersion version);

    @Delete
    void delete(ResourceVersion version);
}
