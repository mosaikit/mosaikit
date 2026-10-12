// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.api.extension.ExtensionManifests;
import dev.mosaikit.kernel.api.extension.ManifestParseResult;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** Extensions are migrated after the extensions they require (MK-020). */
@Tag("MK-020")
class ExtensionMigrationsOrderTest {

    private static InstalledExtension extension(String id, String... requires) {
        Map<String, Object> tree = new java.util.HashMap<>(
                Map.of("id", id, "version", "1.0.0", "name", id, "kind", List.of("service"), "platform", ">=0.1 <1"));
        Map<String, String> required = new java.util.HashMap<>();
        for (String other : requires) {
            required.put(other, "^1");
        }
        tree.put("requires", required);
        var manifest = ((ManifestParseResult.Valid) ExtensionManifests.parse(tree)).manifest();
        return new InstalledExtension(id, Path.of(id), Optional.of(manifest), ExtensionStatus.ACTIVE, List.of());
    }

    @Test
    void putsEveryExtensionAfterThoseItRequires() {
        InstalledExtension reports = extension("dev.test.reports", "dev.test.estimates", "dev.test.activities");
        InstalledExtension estimates = extension("dev.test.estimates", "dev.test.activities", "dev.test.absent");
        InstalledExtension activities = extension("dev.test.activities");
        InstalledExtension other = extension("dev.test.other");

        assertThat(ExtensionMigrations.inDependencyOrder(List.of(reports, other, estimates, activities)))
                .extracting(InstalledExtension::key)
                .containsExactly("dev.test.activities", "dev.test.estimates", "dev.test.reports", "dev.test.other");
    }

    @Test
    void doesNotLoopOnACycle() {
        InstalledExtension a = extension("dev.test.a", "dev.test.b");
        InstalledExtension b = extension("dev.test.b", "dev.test.a");

        assertThat(ExtensionMigrations.inDependencyOrder(List.of(a, b)))
                .extracting(InstalledExtension::key)
                .containsExactlyInAnyOrder("dev.test.a", "dev.test.b");
    }
}
