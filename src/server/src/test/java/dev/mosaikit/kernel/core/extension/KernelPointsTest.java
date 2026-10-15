// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import dev.mosaikit.kernel.api.extension.Contribution;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ExtensionManifests;
import dev.mosaikit.kernel.api.extension.ExtensionPoint;
import dev.mosaikit.kernel.api.extension.ManifestParseResult;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The panels that extensions add to the console (MK-072) go through the typed point {@code
 * console.panel} of the shell (MK-134): a contribution that does not match its schema is refused at
 * installation and never reaches the shell.
 */
@Tag("MK-072")
class KernelPointsTest {

    private static final ObjectMapper YAML = new ObjectMapper(new YAMLFactory());

    private static ExtensionManifest manifest(String contributes) {
        try {
            Map<String, Object> tree = YAML.readValue("""
                    id: org.example.backups
                    version: 1.0.0
                    name: Backups
                    kind: [app]
                    platform: '>=0.1'
                    frontend:
                      entry: web/index.js
                    contributes:
                    %s""".formatted(contributes.indent(2)), new TypeReference<>() {});
            return ((ManifestParseResult.Valid) ExtensionManifests.parse(tree)).manifest();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    private static Contribution only(ExtensionManifest manifest) {
        return manifest.contributions().getFirst();
    }

    @Test
    void thePointOfTheConsoleIsTypedInVersionOne() {
        assertThat(KernelPoints.point("console.panel")).hasValueSatisfying(point -> {
            assertThat(point.version()).isEqualTo(1);
            assertThat(point.payload()).isPresent();
        });
        assertThat(KernelPoints.point("console.panel@2")).isEmpty();
        assertThat(KernelPoints.points())
                .extracting(ExtensionPoint::id)
                .containsExactly("home.widget", "console.panel");
    }

    @Test
    void aPanelWithAnElementAndATitleMatches() {
        ExtensionManifest backups = manifest("""
                console.panel:
                  - id: last-backups
                    title: Last backups
                    element: backups-console-panel
                    description: The backups of the last week
                    order: 20
                    permission: view-backups
                    i18n: { it: { title: Ultimi backup } }
                """);
        assertThat(KernelPoints.problems(only(backups))).isEmpty();
        assertThat(KernelPoints.contributions(backups)).isEmpty();
        assertThat(ContractChecks.matches(only(backups), List.of())).isTrue();
        assertThat(ContractChecks.refuseInstallation(List.of(backups), List.of()))
                .isEmpty();
    }

    @Test
    void aPanelThatDoesNotMatchIsRefusedAtInstallationAndNeverReachesTheShell() {
        ExtensionManifest broken = manifest("""
                console.panel:
                  - id: last-backups
                    element: backups-console-panel
                    size: large
                """);
        assertThat(KernelPoints.problems(only(broken))).isNotEmpty();
        assertThat(ContractChecks.matches(only(broken), List.of())).isFalse();
        assertThat(ContractChecks.refuseInstallation(List.of(broken), List.of()))
                .singleElement()
                .asString()
                .startsWith("the contribution last-backups of org.example.backups 1.0.0 to console.panel"
                        + " does not match the schema of the kernel: ")
                .contains("title")
                .contains("size");
    }

    @Test
    void contributionsToOtherPointsAreNotTheBusinessOfTheShell() {
        ExtensionManifest other = manifest("""
                rail.app:
                  - { id: backups, title: Backups, route: /app/backups, element: backups-app, anything: 1 }
                """);
        assertThat(KernelPoints.problems(only(other))).isEmpty();
        assertThat(KernelPoints.contributions(other)).isEmpty();
    }
}
