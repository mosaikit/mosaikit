// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import jakarta.data.Limit;
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
 * Jakarta Data repository of the requests for access (MK-058). Row-level security already limits the
 * rows to the organization of the request; the queries name it too, as every query of the kernel does.
 */
@Repository
public interface AccessRequests {

    @Find
    Optional<AccessRequest> findById(UUID id);

    /** The pending request of a person for a resource, if any. */
    @Query("""
            from AccessRequest a
            where a.organizationId = :organizationId and a.requesterId = :requesterId
              and a.extensionId = :extensionId and a.resourceType = :resourceType and a.refId = :refId
              and a.status = 'pending'""")
    Optional<AccessRequest> pendingOf(
            UUID organizationId, UUID requesterId, String extensionId, String resourceType, String refId);

    /** The pending requests of the organization, oldest first. */
    @Query("""
            from AccessRequest a
            where a.organizationId = :organizationId and a.status = 'pending'
            order by a.createdAt, a.id""")
    List<AccessRequest> pending(UUID organizationId, Limit limit);

    /** The requests of a person in the organization, newest first. */
    @Query("""
            from AccessRequest a
            where a.organizationId = :organizationId and a.requesterId = :requesterId
            order by a.createdAt desc, a.id""")
    List<AccessRequest> of(UUID organizationId, UUID requesterId, Limit limit);

    @Insert
    void insert(AccessRequest request);

    @Update
    void update(AccessRequest request);

    @Delete
    void delete(AccessRequest request);
}
