// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.Objects;

/**
 * The database schema owned by an extension.
 *
 * @param schema name of the schema, unique across the installation
 * @param migrations path of the migration scripts, relative to the extension root
 */
public record DatabaseEntry(String schema, String migrations) {

    public DatabaseEntry {
        Objects.requireNonNull(schema, "schema");
        Objects.requireNonNull(migrations, "migrations");
    }
}
