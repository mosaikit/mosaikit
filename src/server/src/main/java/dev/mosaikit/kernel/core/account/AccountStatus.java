// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import java.util.UUID;

/**
 * Whether an account may sign in (MK-125).
 *
 * @param suspended whether an administrator suspended it
 */
public record AccountStatus(UUID accountId, String username, boolean suspended) {

    static AccountStatus of(UserAccount account) {
        return new AccountStatus(account.getId(), account.getUsername(), account.isSuspended());
    }
}
