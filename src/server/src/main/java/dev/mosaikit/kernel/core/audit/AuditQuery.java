// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

/**
 * What to look for in the audit log (MK-059); a null criterion matches every entry.
 *
 * @param organization the entries of one organization, or of every one when empty
 * @param platform only the entries of the platform, without organization
 * @param actor who did it, exactly
 * @param action an action, or every action that starts with it when it ends with a dot
 * @param subject the object of the action, exactly
 * @param channel the channel the action came through
 * @param from the entries at or after this time
 * @param to the entries before this time
 * @param offset how many matching entries to skip, newest first
 * @param limit how many entries to return, at most {@link AuditLog#MAX_EVENTS}
 */
public record AuditQuery(
        Optional<UUID> organization,
        boolean platform,
        String actor,
        String action,
        String subject,
        AuditEvent.Channel channel,
        Instant from,
        Instant to,
        int offset,
        int limit) {

    /** The latest entries, of one organization when given. */
    public static AuditQuery latest(Optional<UUID> organization, int limit) {
        return new AuditQuery(organization, false, null, null, null, null, null, null, 0, limit);
    }
}
