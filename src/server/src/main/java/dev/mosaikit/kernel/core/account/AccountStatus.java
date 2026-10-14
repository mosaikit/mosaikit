// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import java.time.Instant;
import java.util.UUID;

/**
 * Whether an account may sign in (MK-125).
 *
 * @param suspended whether an administrator suspended it
 * @param suspendedAt when, or {@code null}
 * @param suspendedBy the username of the administrator who suspended it, or {@code null}
 * @param reason why, as the administrator wrote it, or {@code null}
 */
public record AccountStatus(
        UUID accountId,
        String username,
        String displayName,
        boolean suspended,
        Instant suspendedAt,
        String suspendedBy,
        String reason) {

    static AccountStatus of(UserAccount account) {
        return new AccountStatus(
                account.getId(),
                account.getUsername(),
                account.getDisplayName(),
                account.isSuspended(),
                account.getSuspendedAt().orElse(null),
                account.getSuspendedBy().orElse(null),
                account.getSuspensionReason().orElse(null));
    }
}
