// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import dev.mosaikit.kernel.api.plugin.DatabaseEntry;
import dev.mosaikit.kernel.api.plugin.PluginManifest;
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
 * Migrates the database schema of every active plugin at start, before the kernel accepts
 * requests.
 *
 * <p>Each plugin owns one schema ({@code p_<name>}) with its own Flyway history table, so that
 * plugins are migrated independently of each other and of the kernel. A failed migration stops
 * the start: running plugin code on a schema it does not expect would corrupt data.
 */
@ApplicationScoped
public class PluginMigrations {

    private static final Logger LOG = Logger.getLogger(PluginMigrations.class);

    private final AgroalDataSource dataSource;
    private final RowSecurity rowSecurity;

    public PluginMigrations(AgroalDataSource dataSource, RowSecurity rowSecurity) {
        this.dataSource = dataSource;
        this.rowSecurity = rowSecurity;
    }

    void onPluginsLoaded(@Observes PluginsLoaded event) {
        List<String> schemas = new ArrayList<>();
        for (InstalledPlugin plugin : inDependencyOrder(event.active())) {
            plugin.manifest().flatMap(PluginManifest::database).ifPresent(database -> {
                migrate(plugin, database);
                schemas.add(database.schema());
            });
        }
        // After the migrations, which run as the owner and see every row (MK-019).
        rowSecurity.prepare(schemas);
    }

    private void migrate(InstalledPlugin plugin, DatabaseEntry database) {
        Path scripts = plugin.directory().resolve(database.migrations());
        if (!Files.isDirectory(scripts)) {
            throw new IllegalStateException("Plugin " + plugin.key() + " declares migrations in "
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
                    "Plugin %s: schema %s at version %s (%d migrations applied)",
                    plugin.key(),
                    database.schema(),
                    result.targetSchemaVersion == null ? "unchanged" : result.targetSchemaVersion,
                    result.migrationsExecuted);
        } catch (RuntimeException e) {
            throw new IllegalStateException("Migration of plugin " + plugin.key() + " failed: " + e.getMessage(), e);
        }
    }

    /**
     * The plugins with every plugin after those it requires, so that a migration may use the
     * published views of a required plugin (MK-020); otherwise in their order.
     */
    static List<InstalledPlugin> inDependencyOrder(List<InstalledPlugin> plugins) {
        Map<String, InstalledPlugin> byId = new LinkedHashMap<>();
        plugins.forEach(plugin -> byId.put(plugin.key(), plugin));
        List<InstalledPlugin> ordered = new ArrayList<>();
        Set<String> visited = new HashSet<>();
        for (InstalledPlugin plugin : plugins) {
            visit(plugin, byId, visited, ordered);
        }
        return ordered;
    }

    private static void visit(
            InstalledPlugin plugin,
            Map<String, InstalledPlugin> byId,
            Set<String> visited,
            List<InstalledPlugin> ordered) {
        if (!visited.add(plugin.key())) {
            return;
        }
        plugin.manifest().map(PluginManifest::requires).orElse(Map.of()).keySet().stream()
                .map(byId::get)
                .filter(Objects::nonNull)
                .forEach(required -> visit(required, byId, visited, ordered));
        ordered.add(plugin);
    }
}
