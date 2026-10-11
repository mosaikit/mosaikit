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
 * Jakarta Data repository of the documents of plugins. Row-level security already limits the rows
 * to the organization of the request; the queries name it too, as every query of the kernel does.
 */
@Repository
public interface PluginDocuments {

    @Find
    Optional<PluginDocument> findById(UUID id);

    @Query("""
            from PluginDocument d
            where d.organizationId = :organizationId and d.pluginId = :pluginId
              and d.collection = :collection and d.teamId is null
            order by d.updatedAt desc, d.id""")
    List<PluginDocument> list(UUID organizationId, String pluginId, String collection, Limit limit);

    @Query("""
            from PluginDocument d
            where d.organizationId = :organizationId and d.pluginId = :pluginId
              and d.collection = :collection and d.teamId = :teamId
            order by d.updatedAt desc, d.id""")
    List<PluginDocument> listOfTeam(UUID organizationId, String pluginId, String collection, UUID teamId, Limit limit);

    @Query("""
            select count(d) from PluginDocument d
            where d.organizationId = :organizationId and d.pluginId = :pluginId
              and d.collection = :collection""")
    long count(UUID organizationId, String pluginId, String collection);

    @Insert
    void insert(PluginDocument document);

    @Update
    void update(PluginDocument document);

    @Delete
    void delete(PluginDocument document);
}
