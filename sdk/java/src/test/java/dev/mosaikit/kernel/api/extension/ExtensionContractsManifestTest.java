// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Versioned contracts between extensions in the manifest (MK-134): the points of a frontend in major
 * versions with the JSON Schema of their payload, the contributions that target a version, and the
 * contracts on the server that an extension provides or implements with their API artifact.
 */
@Tag("MK-134")
class ExtensionContractsManifestTest {

    private static final String SHA = "0".repeat(64);

    private static final Map<String, Object> WIDGET_V2 = Map.of(
            "type",
            "object",
            "required",
            List.of("element", "size"),
            "additionalProperties",
            false,
            "properties",
            Map.of(
                    "element",
                    Map.of("type", "string"),
                    "size",
                    Map.of("type", "string", "enum", List.of("small", "large"))));

    private static Map<String, Object> tree() {
        Map<String, Object> tree = new HashMap<>();
        tree.put("id", "org.example.dashboard");
        tree.put("version", "2.1.0");
        tree.put("name", "Dashboard");
        tree.put("kind", List.of("app"));
        tree.put("platform", ">=0.1 <1");
        return tree;
    }

    private static ExtensionManifest valid(Map<String, Object> tree) {
        ManifestParseResult result = ExtensionManifests.parse(tree);
        assertThat(result).isInstanceOf(ManifestParseResult.Valid.class);
        return ((ManifestParseResult.Valid) result).manifest();
    }

    private static List<String> violations(Map<String, Object> tree) {
        ManifestParseResult result = ExtensionManifests.parse(tree);
        assertThat(result).isInstanceOf(ManifestParseResult.Invalid.class);
        return ((ManifestParseResult.Invalid) result)
                .violations().stream()
                        .map(violation -> violation.field() + ": " + violation.message())
                        .toList();
    }

    @Test
    void readsThePointsOfAFrontendInVersionsWithTheSchemaOfTheirPayload() {
        Map<String, Object> tree = tree();
        tree.put(
                "frontend",
                Map.of(
                        "entry",
                        "web/index.js",
                        "points",
                        List.of(
                                "dashboard.filter",
                                Map.of("name", "dashboard.widget"),
                                Map.of("name", "dashboard.widget", "version", 2, "schema", WIDGET_V2))));

        ExtensionManifest manifest = valid(tree);

        assertThat(manifest.frontend().orElseThrow().points())
                .containsExactly("dashboard.filter", "dashboard.widget", "dashboard.widget@2");
        assertThat(manifest.extensionPoints())
                .extracting(ExtensionPoint::id)
                .containsExactly("dashboard.filter", "dashboard.widget", "dashboard.widget@2");
        ExtensionPoint v2 = manifest.extensionPoint("dashboard.widget@2").orElseThrow();
        assertThat(v2.version()).isEqualTo(2);
        assertThat(v2.payload()).isPresent();
        assertThat(manifest.extensionPoint("dashboard.widget").orElseThrow().payload())
                .isEmpty();

        Contribution matching = new Contribution(
                "dashboard.widget@2",
                "weather",
                Map.of("element", "weather-card", "size", "large", "i18n", Map.of("it", Map.of("title", "Meteo"))));
        Contribution wrong = new Contribution("dashboard.widget@2", "traffic", Map.of("element", 3, "color", "red"));
        assertThat(v2.validate(matching)).isEmpty();
        assertThat(v2.validate(wrong))
                .containsExactlyInAnyOrder(
                        "traffic.element must be a string",
                        "traffic.size is required",
                        "traffic.color is not expected");
        assertThat(ExtensionPoint.untyped("dashboard.filter").validate(wrong)).isEmpty();
    }

    @Test
    void readsTheVersionThatAContributionTargets() {
        Map<String, Object> tree = tree();
        tree.put(
                "contributes",
                Map.of(
                        "dashboard.widget",
                        List.of(Map.of("id", "old", "element", "weather-old")),
                        "dashboard.widget@1",
                        List.of(Map.of("id", "same", "element", "weather-same")),
                        "dashboard.widget@2",
                        List.of(Map.of("id", "new", "element", "weather-card"))));

        ExtensionManifest manifest = valid(tree);

        assertThat(manifest.contributionsTo("dashboard.widget"))
                .as("version 1 is the point without a version")
                .extracting(Contribution::id)
                .containsExactlyInAnyOrder("old", "same");
        Contribution v2 = manifest.contributionsTo("dashboard.widget@2").getFirst();
        assertThat(v2.pointName()).isEqualTo("dashboard.widget");
        assertThat(v2.pointVersion()).isEqualTo(2);
        assertThat(manifest.contributionsTo("dashboard.widget").getFirst().pointVersion())
                .isEqualTo(1);
    }

    @Test
    void refusesWrongPointsAndContributionKeys() {
        Map<String, Object> tree = tree();
        tree.put(
                "frontend",
                Map.of(
                        "entry",
                        "web/index.js",
                        "points",
                        List.of(
                                Map.of("name", "dashboard.widget", "version", 0),
                                Map.of("name", "dashboard.widget", "version", 2, "schema", Map.of("type", "string")),
                                Map.of("name", "dashboard.chart", "color", "red"),
                                "dashboard.card",
                                Map.of("name", "dashboard.card", "version", 1))));
        tree.put("contributes", Map.of("dashboard.widget@0", List.of(Map.of("id", "x"))));

        assertThat(violations(tree))
                .containsExactlyInAnyOrder(
                        "frontend.points[0].version: must be a major version, a whole number from 1",
                        "frontend.points[1].schema.type: must be 'object', with named properties",
                        "frontend.points[2].color: is not a property of an extension point",
                        "frontend.points[4]: is declared twice",
                        "contributes.dashboard.widget@0: must be a dotted extension point name, with @<version> after"
                                + " the first");
    }

    @Test
    void readsTheContractsOnTheServerWithTheirApiArtifact() {
        Map<String, Object> owner = tree();
        owner.put("id", "org.example.catalog");
        owner.put("backend", Map.of("jar", "lib/catalog.jar", "api", "catalog"));
        owner.put(
                "libraries",
                List.of(Map.of(
                        "jar", "lib/catalog-api.jar", "coordinates", "org.example:catalog-api:1.3.0", "sha256", SHA)));
        owner.put(
                "contracts",
                Map.of(
                        "provides",
                        List.of(Map.of(
                                "name", "connector", "versions", List.of(2, 1), "api", "org.example:catalog-api"))));

        ExtensionManifest catalog = valid(owner);

        ProvidedContract connector = catalog.providedContract("connector").orElseThrow();
        assertThat(connector.versions()).containsExactly(1, 2);
        assertThat(connector.serves(2)).isTrue();
        assertThat(connector.serves(3)).isFalse();
        assertThat(catalog.contractApis()).containsExactly("org.example:catalog-api");
        assertThat(catalog.isContractApi(catalog.libraries().getFirst())).isTrue();

        Map<String, Object> implementer = tree();
        implementer.put("id", "org.example.catalog.connector.files");
        implementer.put(
                "contracts",
                Map.of("implements", List.of(Map.of("contract", "org.example.catalog/connector", "version", 1))));

        ExtensionManifest files = valid(implementer);

        assertThat(files.implementedContracts()).singleElement().satisfies(contract -> {
            assertThat(contract.contract()).isEqualTo("org.example.catalog/connector");
            assertThat(contract.api()).isEmpty();
        });
        assertThat(files.implementsContract("org.example.catalog", "connector", 1))
                .isTrue();
        assertThat(files.implementsContract("org.example.catalog", "connector", 2))
                .isFalse();
        assertThat(files.contractApis()).isEmpty();
    }

    @Test
    void refusesWrongContracts() {
        Map<String, Object> tree = tree();
        tree.put("backend", Map.of("jar", "lib/dashboard.jar", "api", "dashboard"));
        tree.put(
                "libraries",
                List.of(Map.of("jar", "lib/odd.jar", "coordinates", "org.example:odd:r42", "sha256", SHA)));
        tree.put(
                "contracts",
                Map.of(
                        "provides",
                        List.of(
                                Map.of("name", "Widget", "versions", List.of(1)),
                                Map.of("name", "source", "versions", List.of()),
                                Map.of("name", "feed", "versions", List.of(1, 1), "api", "org.example:missing"),
                                Map.of("name", "odd", "versions", List.of(1), "api", "org.example:odd")),
                        "implements",
                        List.of(
                                Map.of("contract", "org.example.catalog", "version", 1),
                                Map.of("contract", "org.example.dashboard/widget", "version", 1),
                                Map.of("contract", "org.example.catalog/connector"),
                                Map.of("contract", "org.example.catalog/source", "version", 1),
                                Map.of("contract", "org.example.catalog/source", "version", 1)),
                        "requires",
                        List.of()));

        assertThat(violations(tree))
                .containsExactlyInAnyOrder(
                        "contracts.requires: must be provides or implements",
                        "contracts.provides[0].name: must be lowercase letters, digits and '-', such as connector",
                        "contracts.provides[1].versions: must list the major versions served, such as [1, 2]",
                        "contracts.provides[2].versions[1]: is listed twice",
                        "contracts.provides[2].api: must be one of the libraries of the extension:"
                                + " org.example:missing is not",
                        "contracts.provides[3].api: the version r42 of org.example:odd must be a semantic version",
                        "contracts.implements[0].contract: must be <extension>/<name>, such as"
                                + " org.example.catalog/connector",
                        "contracts.implements[1].contract: is a contract of this extension: declare it in provides",
                        "contracts.implements[2].version: is required",
                        "contracts.implements[4]: is declared twice");
    }
}
