// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import java.time.Instant;
import java.util.UUID;

/**
 * A live session of the signed-in person, in their settings (MK-125).
 *
 * @param kind {@code password} for the shell signed in with a password, {@code realm} for the
 *     sign-in through the realm of an organization
 * @param userAgent the browser or client that opened it, as it named itself, or {@code null}
 * @param address the address it was opened from, or {@code null}
 * @param current whether it is the session of this request
 */
public record SessionView(
        UUID id,
        String kind,
        String userAgent,
        String address,
        Instant createdAt,
        Instant lastSeenAt,
        boolean current) {

    static SessionView of(AccountSession session, UUID current) {
        return new SessionView(
                session.getId(),
                session.getKind(),
                session.getUserAgent().orElse(null),
                session.getAddress().orElse(null),
                session.getCreatedAt(),
                session.getLastSeenAt(),
                session.getId().equals(current));
    }
}
