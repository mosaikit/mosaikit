// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web.csp;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.util.List;

/**
 * Reads the external origins that platform administrators listed (MK-128), as the owner of the
 * tables, in a transaction of its own.
 */
@ApplicationScoped
public class AllowedOriginReader {

    private final AllowedOrigins origins;
    private final EntityManager entityManager;

    public AllowedOriginReader(AllowedOrigins origins, EntityManager entityManager) {
        this.origins = origins;
        this.entityManager = entityManager;
    }

    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public List<String> origins() {
        entityManager
                .createNativeQuery("select set_config('role', 'none', true)")
                .getSingleResult();
        return origins.list().stream().map(AllowedOrigin::getOrigin).toList();
    }
}
