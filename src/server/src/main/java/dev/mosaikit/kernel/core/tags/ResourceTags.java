// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.tags;

import jakarta.data.Limit;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.util.List;
import java.util.UUID;

/**
 * Jakarta Data repository of the tags of resources (MK-097). Row-level security already limits the
 * rows to the organization of the request; the queries name it too, as every query of the kernel does.
 */
@Repository
public interface ResourceTags {

    /** The tags of a resource, in alphabetical order. */
    @Query("""
            select t.tag from ResourceTag t
            where t.organizationId = :organizationId and t.resourceId = :resourceId
            order by t.tag""")
    List<String> of(UUID organizationId, UUID resourceId);

    @Insert
    void insert(ResourceTag tag);

    /** Removes the tags of a resource that are not among those given. */
    @Query("""
            delete from ResourceTag t
            where t.organizationId = :organizationId and t.resourceId = :resourceId and t.tag not in :keep""")
    int deleteAllExcept(UUID organizationId, UUID resourceId, List<String> keep);

    /** Removes every tag of a resource. */
    @Query("delete from ResourceTag t where t.organizationId = :organizationId and t.resourceId = :resourceId")
    int deleteAll(UUID organizationId, UUID resourceId);

    /** The identifiers, in the extension, of the resources of a type that carry any of the tags. */
    @Query("""
            select distinct r.refId from RegisteredResource r, ResourceTag t
            where t.resourceId = r.id and t.organizationId = :organizationId and r.organizationId = :organizationId
              and r.extensionId = :extensionId and r.resourceType = :resourceType and t.tag in :tags""")
    List<String> tagged(UUID organizationId, String extensionId, String resourceType, List<String> tags);

    /**
     * The tags of the organization that match a pattern of {@code like} (escape {@code !}), in
     * alphabetical order, for the suggestions.
     */
    @Query("""
            from ResourceTag t
            where t.organizationId = :organizationId and t.tag like :pattern escape '!'
            order by t.tag, t.resourceId""")
    List<ResourceTag> matching(UUID organizationId, String pattern, Limit limit);
}
