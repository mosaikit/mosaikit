// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import java.util.UUID;

/**
 * Unique test data, so that tests do not depend on the state of the database: Dev Services may
 * reuse a container between runs, and the tests of a run share one database.
 */
final class TestData {

    private TestData() {}

    /** A value such as {@code municipality-3f9a1c2b}, valid as organization slug and email local part. */
    static String unique(String prefix) {
        return prefix + "-" + UUID.randomUUID().toString().substring(0, 8);
    }
}
