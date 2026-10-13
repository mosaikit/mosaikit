// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.config;

import dev.mosaikit.kernel.core.security.PasswordHasher;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Singleton;
import java.time.Clock;

/** Produces framework-free collaborators, so that they stay testable and replaceable. */
@ApplicationScoped
public class CoreProducers {

    // @Singleton rather than @ApplicationScoped: immutable, thread-safe objects that need no client
    // proxy (Clock and PasswordHasher cannot be proxied lazily anyway).
    @Produces
    @Singleton
    Clock clock() {
        return Clock.systemUTC();
    }

    // @Singleton for the same reason as the clock.
    @Produces
    @Singleton
    PasswordHasher passwordHasher() {
        return new PasswordHasher();
    }
}
