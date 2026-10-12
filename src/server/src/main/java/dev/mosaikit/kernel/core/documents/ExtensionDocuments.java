// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.documents;

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
 * Jakarta Data repository of the documents of extensions. Row-level security already limits the rows
 * to the organization of the request; the queries name it too, as every query of the kernel does.
 */
@Repository
public interface ExtensionDocuments {

    @Find
    Optional<ExtensionDocument> findById(UUID id);

    @Query("""
            from ExtensionDocument d
            where d.organizationId = :organizationId and d.extensionId = :extensionId
              and d.collection = :collection and d.teamId is null
            order by d.updatedAt desc, d.id""")
    List<ExtensionDocument> list(UUID organizationId, String extensionId, String collection, Limit limit);

    @Query("""
            from ExtensionDocument d
            where d.organizationId = :organizationId and d.extensionId = :extensionId
              and d.collection = :collection and d.teamId = :teamId
            order by d.updatedAt desc, d.id""")
    List<ExtensionDocument> listOfTeam(
            UUID organizationId, String extensionId, String collection, UUID teamId, Limit limit);

    @Query("""
            select count(d) from ExtensionDocument d
            where d.organizationId = :organizationId and d.extensionId = :extensionId
              and d.collection = :collection""")
    long count(UUID organizationId, String extensionId, String collection);

    @Insert
    void insert(ExtensionDocument document);

    @Update
    void update(ExtensionDocument document);

    @Delete
    void delete(ExtensionDocument document);
}
