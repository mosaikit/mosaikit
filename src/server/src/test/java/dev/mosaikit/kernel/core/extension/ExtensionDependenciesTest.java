// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ExtensionManifests;
import dev.mosaikit.kernel.api.extension.ManifestParseResult;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The rules on required and optional dependencies between extensions (MK-132). */
@Tag("MK-132")
class ExtensionDependenciesTest {

    static ExtensionManifest manifest(
            String id, String version, Map<String, String> requires, Map<String, String> optional) {
        Map<String, Object> tree = new HashMap<>();
        tree.put("id", id);
        tree.put("version", version);
        tree.put("name", id);
        tree.put("kind", List.of("extension"));
        tree.put("platform", ">=0.1");
        tree.put("requires", requires);
        tree.put("optional", optional);
        return ((ManifestParseResult.Valid) ExtensionManifests.parse(tree)).manifest();
    }

    static ExtensionManifest manifest(String id, String version) {
        return manifest(id, version, Map.of(), Map.of());
    }

    private static final ExtensionManifest BASE_1 = manifest("dev.example.base", "1.2.0");
    private static final ExtensionManifest BASE_2 = manifest("dev.example.base", "2.0.0");
    private static final ExtensionManifest BOARD_1 =
            manifest("dev.example.board", "1.0.0", Map.of("dev.example.base", "^1"), Map.of());
    private static final ExtensionManifest BOARD_2 =
            manifest("dev.example.board", "2.0.0", Map.of("dev.example.base", "^2"), Map.of());
    private static final ExtensionManifest VIEWER = manifest(
            "dev.example.viewer", "1.0.0", Map.of(), Map.of("dev.example.base", "^1", "dev.example.maps", "^3"));

    @Test
    void refusesAnInstallationWhoseRequiredDependencyIsMissingOrOutOfRange() {
        assertThat(ExtensionDependencies.of(List.of()).refuseInstallation(List.of(BOARD_1)))
                .containsExactly(
                        "dev.example.board 1.0.0: Requires extension dev.example.base ^1, which is not installed");
        assertThat(ExtensionDependencies.of(List.of(BASE_2)).refuseInstallation(List.of(BOARD_1)))
                .containsExactly("dev.example.board 1.0.0: Requires extension dev.example.base ^1, found 2.0.0");
        assertThat(ExtensionDependencies.of(List.of(BASE_1)).refuseInstallation(List.of(BOARD_1)))
                .isEmpty();
        // Together with what it requires, in one operation.
        assertThat(ExtensionDependencies.of(List.of()).refuseInstallation(List.of(BOARD_1, BASE_1)))
                .isEmpty();
    }

    @Test
    void neverRefusesForAnOptionalDependency() {
        assertThat(ExtensionDependencies.of(List.of()).refuseInstallation(List.of(VIEWER)))
                .isEmpty();
        assertThat(ExtensionDependencies.of(List.of(BASE_2)).refuseInstallation(List.of(VIEWER)))
                .isEmpty();
        assertThat(ExtensionDependencies.of(List.of(BASE_1, VIEWER)).usedOptionallyBy("dev.example.base"))
                .extracting(ExtensionDependencies.Dependent::id)
                .containsExactly("dev.example.viewer");
        assertThat(ExtensionDependencies.of(List.of(BASE_1, VIEWER)).requiredBy("dev.example.base"))
                .isEmpty();
    }

    @Test
    void refusesAnUpdateThatTakesAnExtensionOutOfTheRangeOfItsDependents() {
        ExtensionDependencies installed = ExtensionDependencies.of(List.of(BASE_1, BOARD_1, VIEWER));

        assertThat(installed.refuseInstallation(List.of(BASE_2)))
                .singleElement()
                .asString()
                .contains("updating dev.example.base from 1.2.0 to 2.0.0")
                .contains("dev.example.board 1.0.0 (requires ^1)")
                .contains("in the same operation")
                // An optional user is never in the way.
                .doesNotContain("dev.example.viewer");
        assertThat(installed.refuseInstallation(List.of(BASE_2, BOARD_2))).isEmpty();
        assertThat(installed.refuseInstallation(List.of(manifest("dev.example.base", "1.3.0"))))
                .isEmpty();
        // Updating the dependent alone to a version that needs another base is refused too.
        assertThat(installed.refuseInstallation(List.of(BOARD_2)))
                .containsExactly("dev.example.board 2.0.0: Requires extension dev.example.base ^2, found 1.2.0");
    }

    @Test
    void refusesARemovalWhileAnExtensionRequiresIt() {
        ExtensionDependencies installed = ExtensionDependencies.of(List.of(BASE_1, BOARD_1, VIEWER));

        assertThat(installed.refuseRemoval(List.of("dev.example.base")))
                .containsExactly("dev.example.base is required by dev.example.board 1.0.0 (requires ^1)");
        assertThat(installed.refuseRemoval(List.of("dev.example.base", "dev.example.board")))
                .isEmpty();
        assertThat(installed.refuseRemoval(List.of("dev.example.viewer"))).isEmpty();
        assertThat(installed.without(List.of("dev.example.board")).refuseRemoval(List.of("dev.example.base")))
                .isEmpty();
    }

    @Test
    void countsOnlyTheExtensionsThatRunAsDependentsOfARemoval() {
        Path directory = Path.of("extensions");
        List<InstalledExtension> extensions = List.of(
                new InstalledExtension(BASE_1.id(), directory, Optional.of(BASE_1), ExtensionStatus.ACTIVE, List.of()),
                new InstalledExtension(
                        BOARD_1.id(),
                        directory,
                        Optional.of(BOARD_1),
                        ExtensionStatus.INCOMPATIBLE,
                        List.of("Requires kernel >=9")));

        assertThat(ExtensionDependencies.running(extensions).refuseRemoval(List.of(BASE_1.id())))
                .isEmpty();
        // One that waits only for what it requires, such as a package placed before a restart, counts.
        List<InstalledExtension> waiting = List.of(
                extensions.getFirst(),
                new InstalledExtension(
                        BOARD_1.id(),
                        directory,
                        Optional.of(BOARD_1),
                        ExtensionStatus.INCOMPATIBLE,
                        List.of("Requires extension dev.example.base ^1, which is not active")));
        assertThat(ExtensionDependencies.running(waiting).refuseRemoval(List.of(BASE_1.id())))
                .hasSize(1);
        assertThat(ExtensionDependencies.installed(extensions).refuseRemoval(List.of(BASE_1.id())))
                .hasSize(1);
    }

    @Test
    void tellsADependencyThatIsNotActiveFromOneThatIsNotInstalled() {
        assertThat(ExtensionDependencies.unmet(BOARD_1, Map.of(), Set.of("dev.example.base")))
                .singleElement()
                .hasToString("Requires extension dev.example.base ^1, which is not active");
        assertThat(ExtensionDependencies.unmet(BOARD_1, Map.of(), Set.of()))
                .singleElement()
                .hasToString("Requires extension dev.example.base ^1, which is not installed");
    }
}
