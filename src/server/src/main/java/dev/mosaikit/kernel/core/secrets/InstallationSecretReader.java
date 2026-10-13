// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.util.Optional;

/**
 * Reads a credential of the installation for {@link SecretVault} (MK-127). The member role of
 * requests has no right on the table, so the read runs as the owner of the tables, in a transaction
 * of its own: the transaction of the extension that asked, if any, keeps its member role and its
 * row-level security for whatever it does next.
 */
@ApplicationScoped
public class InstallationSecretReader {

    private final InstallationSecrets secrets;
    private final EntityManager entityManager;

    public InstallationSecretReader(InstallationSecrets secrets, EntityManager entityManager) {
        this.secrets = secrets;
        this.entityManager = entityManager;
    }

    /** The credential of the installation with this name, sealed as stored. */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public Optional<InstallationSecret> find(String name) {
        entityManager
                .createNativeQuery("select set_config('role', 'none', true)")
                .getSingleResult();
        return secrets.find(name);
    }
}
