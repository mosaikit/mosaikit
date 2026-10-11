// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.api.plugin.ManifestParseResult;
import dev.mosaikit.kernel.api.plugin.PluginManifests;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** Plugins are migrated after the plugins they require (MK-020). */
@Tag("MK-020")
class PluginMigrationsOrderTest {

    private static InstalledPlugin plugin(String id, String... requires) {
        Map<String, Object> tree = new java.util.HashMap<>(
                Map.of("id", id, "version", "1.0.0", "name", id, "kind", List.of("service"), "platform", ">=0.1 <1"));
        Map<String, String> required = new java.util.HashMap<>();
        for (String other : requires) {
            required.put(other, "^1");
        }
        tree.put("requires", required);
        var manifest = ((ManifestParseResult.Valid) PluginManifests.parse(tree)).manifest();
        return new InstalledPlugin(id, Path.of(id), Optional.of(manifest), PluginStatus.ACTIVE, List.of());
    }

    @Test
    void putsEveryPluginAfterThoseItRequires() {
        InstalledPlugin reports = plugin("dev.test.reports", "dev.test.estimates", "dev.test.activities");
        InstalledPlugin estimates = plugin("dev.test.estimates", "dev.test.activities", "dev.test.absent");
        InstalledPlugin activities = plugin("dev.test.activities");
        InstalledPlugin other = plugin("dev.test.other");

        assertThat(PluginMigrations.inDependencyOrder(List.of(reports, other, estimates, activities)))
                .extracting(InstalledPlugin::key)
                .containsExactly("dev.test.activities", "dev.test.estimates", "dev.test.reports", "dev.test.other");
    }

    @Test
    void doesNotLoopOnACycle() {
        InstalledPlugin a = plugin("dev.test.a", "dev.test.b");
        InstalledPlugin b = plugin("dev.test.b", "dev.test.a");

        assertThat(PluginMigrations.inDependencyOrder(List.of(a, b)))
                .extracting(InstalledPlugin::key)
                .containsExactlyInAnyOrder("dev.test.a", "dev.test.b");
    }
}
