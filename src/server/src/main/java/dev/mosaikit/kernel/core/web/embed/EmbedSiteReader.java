// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web.embed;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads the sites of every organization that is not deleted (MK-100), as the owner of the tables, in a
 * transaction of its own: the framing filter answers every request from memory.
 */
@ApplicationScoped
public class EmbedSiteReader {

    private final EntityManager entityManager;

    public EmbedSiteReader(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    /** The sites by slug of their organization. */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public Map<String, List<String>> sites() {
        entityManager
                .createNativeQuery("select set_config('role', 'none', true)")
                .getSingleResult();
        // Organization leaves out the deleted organizations (MK-130): their sites frame nothing.
        List<Object[]> rows = entityManager
                .createQuery(
                        "select o.slug, s.origin from EmbedSite s, Organization o where o.id = s.organizationId"
                                + " order by o.slug, s.origin",
                        Object[].class)
                .getResultList();
        Map<String, List<String>> result = new LinkedHashMap<>();
        for (Object[] row : rows) {
            result.computeIfAbsent((String) row[0], _ -> new ArrayList<>()).add((String) row[1]);
        }
        result.replaceAll((_, origins) -> List.copyOf(origins));
        return result;
    }
}
