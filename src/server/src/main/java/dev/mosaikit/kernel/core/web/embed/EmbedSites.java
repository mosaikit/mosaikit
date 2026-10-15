// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web.embed;

import jakarta.data.repository.Delete;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Jakarta Data repository of the sites that may frame the views of organizations (MK-100). The member
 * role of requests has no right on the table: callers run as the owner first.
 */
@Repository
public interface EmbedSites {

    @Query("from EmbedSite s where s.organizationId = :organizationId order by s.origin")
    List<EmbedSite> of(UUID organizationId);

    @Query("from EmbedSite s where s.organizationId = :organizationId and s.origin = :origin")
    Optional<EmbedSite> find(UUID organizationId, String origin);

    @Insert
    void insert(EmbedSite site);

    @Delete
    void delete(EmbedSite site);
}
