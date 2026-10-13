// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;

/**
 * A credential of the installation (MK-127), kept by the platform administrators for every
 * organization: the account of a service shared by the whole installation, a mail relay, a licence
 * key. Sealed like those of organizations, and bound to the scope of the installation, so that a row
 * copied from or to an organization does not decrypt. The table belongs to no organization: the
 * member role of requests has no right on it (ADR-0018), and only the kernel reads it, as the owner.
 */
@Entity
@Table(name = "installation_secret")
public class InstallationSecret extends SealedCredential {

    /** Required by JPA. */
    protected InstallationSecret() {}

    InstallationSecret(String name, Instant now) {
        super(name, now);
    }

    @Override
    byte[] binding() {
        return SecretCipher.installationBinding(getName());
    }
}
