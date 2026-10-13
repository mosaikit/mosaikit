// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A credential of an organization (MK-062), sealed and bound to its organization and name. Under
 * row-level security: a request sees the credentials of its organization only.
 */
@Entity
@Table(name = "secret")
public class StoredSecret extends SealedCredential {

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    /** Required by JPA. */
    protected StoredSecret() {}

    StoredSecret(UUID organizationId, String name, Instant now) {
        super(name, now);
        this.organizationId = organizationId;
    }

    @Override
    byte[] binding() {
        return SecretCipher.binding(organizationId, getName());
    }

    public UUID getOrganizationId() {
        return organizationId;
    }
}
