// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ExtensionManifests;
import dev.mosaikit.kernel.api.extension.LibraryEntry;
import dev.mosaikit.kernel.api.extension.ManifestParseResult;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The checks of the contracts between extensions at installation (MK-134): contributions against the
 * schema of the version of the point they target, implementations against the versions the owner
 * serves, and the API artifacts of contracts, compatible in the same major version.
 */
@Tag("MK-134")
class ContractChecksTest {

    private static final ObjectMapper YAML = new ObjectMapper(new YAMLFactory());

    private static ExtensionManifest manifest(String id, String version, String extra) {
        try {
            Map<String, Object> tree = YAML.readValue("""
                    id: %s
                    version: %s
                    name: Test
                    kind: [app]
                    platform: '>=0.1'
                    %s""".formatted(id, version, extra), new TypeReference<>() {});
            return ((ManifestParseResult.Valid) ExtensionManifests.parse(tree)).manifest();
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
    }

    /** A dashboard that serves its widget point in versions 1 (untyped) and 2 (typed). */
    private static ExtensionManifest dashboard(String version, String sizes) {
        return manifest("org.example.dashboard", version, """
                frontend:
                  entry: web/index.js
                  points:
                    - dashboard.widget
                    - name: dashboard.widget
                      version: 2
                      schema:
                        type: object
                        required: [element, size]
                        additionalProperties: false
                        properties:
                          element: { type: string }
                          size: { type: string, enum: [%s] }
                          title: { type: string }
                """.formatted(sizes));
    }

    private static ExtensionManifest weather(String size) {
        return manifest("org.example.weather", "1.0.0", """
                contributes:
                  dashboard.widget:
                    - { id: old, anything: [1, 2] }
                  dashboard.widget@2:
                    - { id: card, element: weather-card, size: %s, i18n: { it: { title: Meteo } } }
                """.formatted(size));
    }

    private static final ExtensionManifest CATALOG = manifest("org.example.catalog", "2.0.0", """
            contracts:
              provides: [{ name: connector, versions: [2, 3] }]
            """);

    private static ExtensionManifest connector(int version) {
        return manifest("org.example.connector", "1.0.0", """
                contracts:
                  implements: [{ contract: org.example.catalog/connector, version: %d }]
                """.formatted(version));
    }

    @Test
    void refusesAContributionThatDoesNotMatchTheSchemaOfTheVersionItTargets() {
        assertThat(ContractChecks.refuseInstallation(
                        List.of(weather("large")), List.of(dashboard("1.0.0", "small, large"))))
                .isEmpty();

        assertThat(ContractChecks.refuseInstallation(
                        List.of(weather("huge")), List.of(dashboard("1.0.0", "small, large"))))
                .containsExactly("the contribution card of org.example.weather 1.0.0 to dashboard.widget@2 does not"
                        + " match the schema of org.example.dashboard 1.0.0: card.size must be one of [small, large]");

        assertThat(ContractChecks.refuseInstallation(List.of(weather("huge")), List.of()))
                .as("without the owner, there is nothing to match")
                .isEmpty();
    }

    @Test
    void refusesAnOwnerWhoseSchemaTheInstalledContributionsDoNotMatchUnlessUpdatedTogether() {
        ExtensionManifest stricter = dashboard("1.1.0", "small");

        assertThat(ContractChecks.refuseInstallation(
                        List.of(stricter), List.of(dashboard("1.0.0", "small, large"), weather("large"))))
                .singleElement()
                .asString()
                .contains("the contribution card of org.example.weather 1.0.0")
                .contains("org.example.dashboard 1.1.0: card.size must be one of [small]");
        assertThat(ContractChecks.refuseInstallation(List.of(stricter, weather("small")), List.of(weather("large"))))
                .isEmpty();
        // Retiring version 2: the contributions to it are no longer served, nothing to refuse.
        ExtensionManifest retired = manifest(
                "org.example.dashboard", "3.0.0", "frontend:\n  entry: web/index.js\n  points: [dashboard.widget]\n");
        assertThat(ContractChecks.refuseInstallation(List.of(retired), List.of(weather("huge"))))
                .isEmpty();
    }

    @Test
    void servesOnlyTheContributionsThatMatchTheirPoint() {
        List<ExtensionManifest> owners = List.of(dashboard("1.0.0", "small, large"));

        assertThat(ContractChecks.matches(
                        weather("large").contributionsTo("dashboard.widget@2").getFirst(), owners))
                .isTrue();
        assertThat(ContractChecks.matches(
                        weather("huge").contributionsTo("dashboard.widget@2").getFirst(), owners))
                .isFalse();
        assertThat(ContractChecks.matches(
                        weather("huge").contributionsTo("dashboard.widget").getFirst(), owners))
                .as("version 1 of the point has no schema")
                .isTrue();
    }

    @Test
    void refusesAnImplementationOfAVersionThatTheOwnerDoesNotServe() {
        assertThat(ContractChecks.refuseInstallation(List.of(connector(2)), List.of(CATALOG)))
                .isEmpty();
        assertThat(ContractChecks.refuseInstallation(List.of(connector(1)), List.of(CATALOG)))
                .containsExactly("org.example.connector 1.0.0 implements org.example.catalog/connector version 1,"
                        + " which org.example.catalog 2.0.0 does not serve (it serves version 2, 3)");
        assertThat(ContractChecks.refuseInstallation(List.of(connector(1)), List.of()))
                .isEmpty();
        ExtensionManifest withoutContract = manifest("org.example.catalog", "3.0.0", "");
        assertThat(ContractChecks.refuseInstallation(List.of(connector(2)), List.of(withoutContract)))
                .singleElement()
                .asString()
                .endsWith("which org.example.catalog 3.0.0 does not provide");
        assertThat(ContractChecks.refuseInstallation(List.of(withoutContract), List.of(connector(2))))
                .as("an owner that retires a contract is not refused")
                .isEmpty();
    }

    @Test
    void holdsTheApiArtifactOfAContractInTheHighestCompatibleVersion() {
        LibraryEntry api12 = library("catalog-api", "1.2.0", "a");
        LibraryEntry api14 = library("catalog-api", "1.4.0", "b");
        LibraryEntry api20 = library("catalog-api", "2.0.0", "c");

        assertThat(ContractApis.compatible(api12, api14, true)).isTrue();
        assertThat(ContractApis.compatible(api12, api14, false))
                .as("a plain library: one version")
                .isFalse();
        assertThat(ContractApis.compatible(api12, api20, true)).isFalse();
        assertThat(ContractApis.compatible(api12, library("catalog-api", "1.2.0", "d"), true))
                .as("the same version must be the same JAR")
                .isFalse();
        assertThat(ContractApis.highest(api12, api14)).isEqualTo(api14);
        assertThat(ContractApis.highest(api14, api12)).isEqualTo(api14);
        assertThat(ContractApis.satisfies(api14, api12, true)).isTrue();
        assertThat(ContractApis.satisfies(api12, api14, true)).isFalse();
        assertThat(ContractApis.satisfies(api12, api12, true)).isTrue();
        assertThat(ContractApis.conflict(api20, api12, "org.example.catalog", true))
                .startsWith("API artifact org.example:catalog-api 2.0.0 conflicts with version 1.2.0 brought by"
                        + " extension org.example.catalog");
        assertThat(ContractApis.conflict(api14, api12, "org.example.catalog", false))
                .startsWith("Library org.example:catalog-api 1.4.0 conflicts with version 1.2.0");
    }

    @Test
    void installsAnExtensionThatBringsACompatibleVersionOfAnApiArtifact() {
        String libraries = """
                backend: { jar: lib/code.jar, api: %s }
                libraries:
                  - { jar: lib/catalog-api.jar, coordinates: "org.example:catalog-api:%s", sha256: "%s" }
                contracts:
                  %s
                """;
        ExtensionManifest catalog = manifest(
                "org.example.catalog",
                "1.0.0",
                libraries.formatted(
                        "catalog",
                        "1.2.0",
                        "a".repeat(64),
                        "provides: [{ name: connector, versions: [1], api: \"org.example:catalog-api\" }]"));
        String implementsIt = "implements: [{ contract: org.example.catalog/connector, version: 1,"
                + " api: \"org.example:catalog-api\" }]";
        ExtensionManifest compatible = manifest(
                "org.example.files", "1.0.0", libraries.formatted("files", "1.4.0", "b".repeat(64), implementsIt));
        ExtensionManifest breaking =
                manifest("org.example.web", "1.0.0", libraries.formatted("web", "2.0.0", "c".repeat(64), implementsIt));
        List<InstalledExtension> installed = List.of(new InstalledExtension(
                catalog.id(), Path.of("catalog"), java.util.Optional.of(catalog), ExtensionStatus.ACTIVE, List.of()));

        assertThat(LibraryConflicts.of(compatible, installed, KernelLibraries.none()))
                .isEmpty();
        assertThat(LibraryConflicts.of(breaking, installed, KernelLibraries.none()))
                .singleElement()
                .asString()
                .startsWith("API artifact org.example:catalog-api 2.0.0 conflicts with version 1.2.0 brought by"
                        + " extension org.example.catalog");
    }

    private static LibraryEntry library(String artifactId, String version, String digit) {
        return LibraryEntry.of(
                        "lib/" + artifactId + ".jar", "org.example:" + artifactId + ":" + version, digit.repeat(64))
                .orElseThrow();
    }
}
