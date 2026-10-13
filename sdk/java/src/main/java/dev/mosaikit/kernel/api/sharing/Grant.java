// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.sharing;

import dev.mosaikit.kernel.api.resource.ResourceRef;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * A resource shared with a subject at a level (MK-055). A grant only adds: the level a person has on
 * a resource is the highest of the levels that its grants give them, and no grant takes a level
 * away.
 *
 * @param id identifier of the grant, to revoke it
 * @param resource the shared resource
 * @param subject who it is shared with
 * @param level a level declared for the type of the resource, such as {@code view}
 * @param grantedBy the account of the person who shared it
 * @param granted when it was shared
 */
public record Grant(UUID id, ResourceRef resource, Subject subject, String level, UUID grantedBy, Instant granted) {

    public Grant {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(resource, "resource");
        Objects.requireNonNull(subject, "subject");
        Objects.requireNonNull(level, "level");
        Objects.requireNonNull(grantedBy, "grantedBy");
        Objects.requireNonNull(granted, "granted");
    }
}
