// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import dev.mosaikit.kernel.api.extension.DatabaseEntry;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.core.data.RowSecurity;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.output.MigrateResult;
import org.jboss.logging.Logger;

/**
 * Migrates the database schema of every active extension at start, before the kernel accepts
 * requests.
 *
 * <p>Each extension owns one schema ({@code p_<name>}) with its own Flyway history table, so that
 * extensions are migrated independently of each other and of the kernel. A failed migration stops
 * the start: running extension code on a schema it does not expect would corrupt data.
 */
@ApplicationScoped
public class ExtensionMigrations {

    private static final Logger LOG = Logger.getLogger(ExtensionMigrations.class);

    private final AgroalDataSource dataSource;
    private final RowSecurity rowSecurity;

    public ExtensionMigrations(AgroalDataSource dataSource, RowSecurity rowSecurity) {
        this.dataSource = dataSource;
        this.rowSecurity = rowSecurity;
    }

    void onExtensionsLoaded(@Observes ExtensionsLoaded event) {
        List<String> schemas = new ArrayList<>();
        for (InstalledExtension extension : inDependencyOrder(event.active())) {
            extension.manifest().flatMap(ExtensionManifest::database).ifPresent(database -> {
                migrate(extension, database);
                schemas.add(database.schema());
            });
        }
        // After the migrations, which run as the owner and see every row (MK-019).
        rowSecurity.prepare(schemas);
    }

    private void migrate(InstalledExtension extension, DatabaseEntry database) {
        Path scripts = extension.directory().resolve(database.migrations());
        if (!Files.isDirectory(scripts)) {
            throw new IllegalStateException("Extension " + extension.key() + " declares migrations in "
                    + database.migrations() + ", which is not a directory");
        }
        try {
            MigrateResult result = Flyway.configure()
                    .dataSource(dataSource)
                    .schemas(database.schema())
                    .createSchemas(true)
                    .locations("filesystem:" + scripts.toAbsolutePath())
                    .load()
                    .migrate();
            LOG.infof(
                    "Extension %s: schema %s at version %s (%d migrations applied)",
                    extension.key(),
                    database.schema(),
                    result.targetSchemaVersion == null ? "unchanged" : result.targetSchemaVersion,
                    result.migrationsExecuted);
        } catch (RuntimeException e) {
            throw new IllegalStateException(
                    "Migration of extension " + extension.key() + " failed: " + e.getMessage(), e);
        }
    }

    /**
     * The extensions with every extension after those it requires, so that a migration may use the
     * published views of a required extension (MK-020); otherwise in their order.
     */
    static List<InstalledExtension> inDependencyOrder(List<InstalledExtension> extensions) {
        Map<String, InstalledExtension> byId = new LinkedHashMap<>();
        extensions.forEach(extension -> byId.put(extension.key(), extension));
        List<InstalledExtension> ordered = new ArrayList<>();
        Set<String> visited = new HashSet<>();
        for (InstalledExtension extension : extensions) {
            visit(extension, byId, visited, ordered);
        }
        return ordered;
    }

    private static void visit(
            InstalledExtension extension,
            Map<String, InstalledExtension> byId,
            Set<String> visited,
            List<InstalledExtension> ordered) {
        if (!visited.add(extension.key())) {
            return;
        }
        extension.manifest().map(ExtensionManifest::requires).orElse(Map.of()).keySet().stream()
                .map(byId::get)
                .filter(Objects::nonNull)
                .forEach(required -> visit(required, byId, visited, ordered));
        ordered.add(extension);
    }
}
