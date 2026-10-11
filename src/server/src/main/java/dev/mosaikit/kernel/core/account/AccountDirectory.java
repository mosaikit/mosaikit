// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

/** Finds accounts for the services of the kernel that know a person by their username. */
@ApplicationScoped
@Transactional
public class AccountDirectory {

    private final UserAccounts accounts;

    public AccountDirectory(UserAccounts accounts) {
        this.accounts = accounts;
    }

    /** The identifier of the account of a username. */
    public Optional<UUID> idOf(String username) {
        return accounts.findByUsername(username.trim().toLowerCase(Locale.ROOT)).map(UserAccount::getId);
    }
}
