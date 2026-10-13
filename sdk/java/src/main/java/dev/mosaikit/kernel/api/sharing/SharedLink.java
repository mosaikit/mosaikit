// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.sharing;

import java.util.Objects;

/**
 * A link made by the kernel for a resource (MK-055).
 *
 * @param grant the grant of the link, whose subject is a {@link Subject.Link}; revoking it revokes the
 *     link
 * @param address the address to give to people, a path of the installation with the secret of the
 *     link; the kernel keeps only a hash of the secret, so the address is given once, here
 */
public record SharedLink(Grant grant, String address) {

    public SharedLink {
        Objects.requireNonNull(grant, "grant");
        Objects.requireNonNull(address, "address");
        if (!(grant.subject() instanceof Subject.Link)) {
            throw new IllegalArgumentException("the grant of a link has a link as its subject");
        }
    }
}
