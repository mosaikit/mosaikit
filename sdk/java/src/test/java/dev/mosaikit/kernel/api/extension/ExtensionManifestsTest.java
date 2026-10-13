// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.api.sharing.SubjectKind;
import dev.mosaikit.kernel.api.version.Version;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

@Tag("MK-005")
class ExtensionManifestsTest {

    private static Map<String, Object> validTree() {
        Map<String, Object> tree = new HashMap<>();
        tree.put("id", "dev.example.traffic");
        tree.put("version", "2.3.1");
        tree.put("name", "Traffic");
        tree.put("description", "Road traffic monitoring");
        tree.put("kind", List.of("app", "service"));
        tree.put("platform", ">=0.1 <1");
        tree.put("requires", Map.of("app.maps", "^3.0"));
        tree.put("frontend", Map.of("entry", "web/index.js", "isolation", "iframe"));
        tree.put("backend", Map.of("jar", "lib/traffic.jar", "api", "traffic"));
        tree.put("database", Map.of("schema", "ext_traffic", "migrations", "db"));
        tree.put(
                "contributes",
                Map.of("launcher.app", List.of(Map.of("id", "traffic", "route", "/app/traffic", "icon", "road"))));
        return tree;
    }

    private static ExtensionManifest parseValid(Map<String, Object> tree) {
        ManifestParseResult result = ExtensionManifests.parse(tree);
        assertThat(result).isInstanceOf(ManifestParseResult.Valid.class);
        return ((ManifestParseResult.Valid) result).manifest();
    }

    private static List<ManifestViolation> parseInvalid(Map<String, Object> tree) {
        ManifestParseResult result = ExtensionManifests.parse(tree);
        assertThat(result).isInstanceOf(ManifestParseResult.Invalid.class);
        return ((ManifestParseResult.Invalid) result).violations();
    }

    @Test
    void readsACompleteManifest() {
        ExtensionManifest manifest = parseValid(validTree());

        assertThat(manifest.id()).isEqualTo("dev.example.traffic");
        assertThat(manifest.version()).isEqualTo(Version.of(2, 3, 1));
        assertThat(manifest.kinds()).containsExactlyInAnyOrder(ExtensionKind.APP, ExtensionKind.SERVICE);
        assertThat(manifest.supportsPlatform(Version.of(0, 4, 0))).isTrue();
        assertThat(manifest.supportsPlatform(Version.of(1, 0, 0))).isFalse();
        assertThat(manifest.requires()).containsKey("app.maps");
        assertThat(manifest.frontend()).contains(new FrontendEntry("web/index.js", FrontendIsolation.IFRAME));
        assertThat(manifest.backend()).contains(new BackendEntry("lib/traffic.jar", "traffic"));
        assertThat(manifest.database()).contains(new DatabaseEntry("ext_traffic", "db"));
        assertThat(manifest.contributionsTo("launcher.app")).singleElement().satisfies(contribution -> {
            assertThat(contribution.id()).isEqualTo("traffic");
            assertThat(contribution.attributes())
                    .containsEntry("route", "/app/traffic")
                    .doesNotContainKey("id");
        });
        assertThat(manifest).hasToString("dev.example.traffic@2.3.1");
    }

    @Test
    void acceptsASingleKindAndDefaultsTheFrontendToModule() {
        Map<String, Object> tree = validTree();
        tree.put("kind", "extension");
        tree.put("frontend", Map.of("entry", "web/index.js"));
        tree.remove("database");
        tree.remove("backend");
        tree.remove("description");

        ExtensionManifest manifest = parseValid(tree);

        assertThat(manifest.kinds()).containsExactly(ExtensionKind.EXTENSION);
        assertThat(manifest.frontend()).map(FrontendEntry::isolation).contains(FrontendIsolation.MODULE);
        assertThat(manifest.database()).isEmpty();
        assertThat(manifest.backend()).isEmpty();
        assertThat(manifest.description()).isEmpty();
    }

    @Test
    void reportsEveryMissingRequiredField() {
        List<ManifestViolation> violations = parseInvalid(new HashMap<>());

        assertThat(violations)
                .extracting(ManifestViolation::field)
                .containsExactlyInAnyOrder("id", "version", "name", "kind", "platform");
    }

    @ParameterizedTest
    @ValueSource(strings = {"Traffic", "traffic", "dev..traffic", "dev.Traffic", "1dev.traffic"})
    void rejectsIdentifiersThatAreNotReverseDns(String id) {
        Map<String, Object> tree = validTree();
        tree.put("id", id);

        assertThat(parseInvalid(tree)).extracting(ManifestViolation::field).containsExactly("id");
    }

    @ParameterizedTest
    @ValueSource(strings = {"../escape.js", "/etc/passwd", "web\\index.js", "c:/index.js", "web/../../x.js"})
    void rejectsFrontendPathsOutsideTheExtension(String entry) {
        Map<String, Object> tree = validTree();
        tree.put("frontend", Map.of("entry", entry));

        assertThat(parseInvalid(tree)).extracting(ManifestViolation::field).containsExactly("frontend.entry");
    }

    @ParameterizedTest
    @ValueSource(strings = {"../outside.jar", "/opt/lib/code.jar", "lib/code.zip", "lib/code"})
    @Tag("MK-011")
    void rejectsBackendJarsThatAreNotJarsInsideTheExtension(String jar) {
        Map<String, Object> tree = validTree();
        tree.put("backend", Map.of("jar", jar, "api", "traffic"));

        assertThat(parseInvalid(tree)).extracting(ManifestViolation::field).containsExactly("backend.jar");
    }

    @ParameterizedTest
    @ValueSource(strings = {"Traffic", "traffic/lights", "../x", "t", "9traffic"})
    @Tag("MK-011")
    void rejectsBackendApiNamesThatAreNotPathSegments(String api) {
        Map<String, Object> tree = validTree();
        tree.put("backend", Map.of("jar", "lib/traffic.jar", "api", api));

        assertThat(parseInvalid(tree)).extracting(ManifestViolation::field).containsExactly("backend.api");
    }

    @Test
    @Tag("MK-011")
    void requiresBothTheJarAndTheApiOfABackend() {
        Map<String, Object> tree = validTree();
        tree.put("backend", Map.of("other", "x"));

        assertThat(parseInvalid(tree))
                .extracting(ManifestViolation::field)
                .containsExactlyInAnyOrder("backend.jar", "backend.api");
    }

    @Test
    void rejectsSchemasOutsideTheExtensionNamespace() {
        Map<String, Object> tree = validTree();
        tree.put("database", Map.of("schema", "public"));

        assertThat(parseInvalid(tree)).extracting(ManifestViolation::field).containsExactly("database.schema");
    }

    @Test
    @Tag("MK-046")
    void readsTheCollectionsOfDocumentsOfAExtension() {
        Map<String, Object> tree = validTree();
        tree.put("data", Map.of("collections", List.of("items", "saved-views")));

        ExtensionManifest manifest = parseValid(tree);

        assertThat(manifest.data()).hasValueSatisfying(data -> {
            assertThat(data.collections()).containsExactly("items", "saved-views");
            assertThat(data.declares("items")).isTrue();
            assertThat(data.declares("other")).isFalse();
        });
        assertThat(parseValid(validTree()).data()).isEmpty();
    }

    @Test
    @Tag("MK-046")
    void rejectsCollectionNamesThatAreNotPathSegmentsAndDuplicates() {
        Map<String, Object> tree = validTree();
        tree.put("data", Map.of("collections", List.of("Items", "items", "items", "a/b")));
        assertThat(parseInvalid(tree))
                .extracting(ManifestViolation::field)
                .containsExactly("data.collections[0]", "data.collections[2]", "data.collections[3]");

        Map<String, Object> empty = validTree();
        empty.put("data", Map.of("collections", List.of()));
        assertThat(parseInvalid(empty)).extracting(ManifestViolation::field).containsExactly("data.collections");
    }

    @Test
    @Tag("MK-028")
    void readsTheThemeOfAThemeExtension() {
        Map<String, Object> tree = validTree();
        tree.put("kind", List.of("theme"));
        tree.put(
                "theme",
                Map.of(
                        "title",
                        "Green",
                        "radius",
                        8,
                        "light",
                        Map.of("brand", "#1B6E3C"),
                        "dark",
                        Map.of("brand", "#58c487", "background", "#101410")));

        ExtensionManifest manifest = parseValid(tree);

        assertThat(manifest.theme()).hasValueSatisfying(theme -> {
            assertThat(theme.title()).isEqualTo("Green");
            assertThat(theme.radius()).isEqualTo(8);
            assertThat(theme.light()).containsEntry("brand", "#1b6e3c");
            assertThat(theme.dark()).hasSize(2);
            assertThat(theme.font()).isNull();
        });
        assertThat(parseValid(validTree()).theme()).isEmpty();
    }

    @Test
    @Tag("MK-052")
    void readsTheProductAndTheLogoOfATheme() {
        Map<String, Object> tree = validTree();
        tree.put("kind", List.of("theme"));
        tree.put(
                "theme",
                Map.of(
                        "title",
                        "Acme",
                        "product",
                        "Acme Maps",
                        "logo",
                        Map.of("light", "web/logo.svg", "dark", "web/logo-dark.png")));

        assertThat(parseValid(tree).theme()).hasValueSatisfying(theme -> {
            assertThat(theme.product()).isEqualTo("Acme Maps");
            assertThat(theme.logo()).isEqualTo("web/logo.svg");
            assertThat(theme.logoDark()).isEqualTo("web/logo-dark.png");
        });

        Map<String, Object> plain = validTree();
        plain.put("theme", Map.of("title", "Plain"));
        assertThat(parseValid(plain).theme()).hasValueSatisfying(theme -> {
            assertThat(theme.product()).isNull();
            assertThat(theme.logo()).isNull();
            assertThat(theme.logoDark()).isNull();
        });
    }

    @Test
    @Tag("MK-052")
    void rejectsProductNamesAndLogosThatTheShellCannotShow() {
        Map<String, Object> tree = validTree();
        tree.put(
                "theme",
                Map.of(
                        "title",
                        "Broken",
                        "product",
                        "<script>",
                        "logo",
                        Map.of("light", "../outside.svg", "dark", "web/logo.gif")));
        assertThat(parseInvalid(tree))
                .extracting(ManifestViolation::field)
                .containsExactlyInAnyOrder("theme.product", "theme.logo.light", "theme.logo.dark");

        Map<String, Object> withoutLight = validTree();
        withoutLight.put("theme", Map.of("title", "Dark only", "logo", Map.of("dark", "web/logo.svg")));
        assertThat(parseInvalid(withoutLight))
                .extracting(ManifestViolation::field)
                .containsExactly("theme.logo.light");

        Map<String, Object> notAMap = validTree();
        notAMap.put("theme", Map.of("title", "Flat", "logo", "web/logo.svg"));
        assertThat(parseInvalid(notAMap)).extracting(ManifestViolation::field).containsExactly("theme.logo");
    }

    @Test
    @Tag("MK-028")
    void rejectsThemesThatTheShellCannotUse() {
        Map<String, Object> tree = validTree();
        tree.put(
                "theme",
                Map.of(
                        "title",
                        "Broken",
                        "radius",
                        99,
                        "font",
                        "url(evil)",
                        "light",
                        Map.of("brand", "red", "glow", "#ffffff")));
        assertThat(parseInvalid(tree))
                .extracting(ManifestViolation::field)
                .containsExactlyInAnyOrder("theme.radius", "theme.font", "theme.light.brand", "theme.light.glow");

        Map<String, Object> withoutTheme = validTree();
        withoutTheme.put("kind", List.of("theme"));
        assertThat(parseInvalid(withoutTheme))
                .extracting(ManifestViolation::field)
                .containsExactly("theme");
    }

    @Test
    void reportsInvalidVersionsAndRanges() {
        Map<String, Object> tree = validTree();
        tree.put("version", "2.3");
        tree.put("platform", "not a range");
        tree.put("requires", Map.of("Maps", "^3"));

        assertThat(parseInvalid(tree))
                .extracting(ManifestViolation::field)
                .containsExactlyInAnyOrder("version", "platform", "requires.Maps");
    }

    @Test
    void reportsMalformedContributions() {
        Map<String, Object> tree = validTree();
        tree.put(
                "contributes",
                Map.of("launcher.app", List.of(Map.of("route", "/x"), "text"), "shell.command", "not a list"));

        assertThat(parseInvalid(tree))
                .extracting(ManifestViolation::field)
                .containsExactlyInAnyOrder(
                        "contributes.launcher.app[0].id", "contributes.launcher.app[1]", "contributes.shell.command");
    }

    @Test
    @Tag("MK-053")
    void readsTheTextsOfAContributionByLanguage() {
        Map<String, Object> tree = validTree();
        tree.put(
                "contributes",
                Map.of(
                        "rail.app",
                        List.of(Map.of(
                                "id",
                                "catalog",
                                "title",
                                "Catalog",
                                "i18n",
                                Map.of("it", Map.of("title", "Catalogo"), "pt-BR", Map.of("title", "Catálogo"))))));

        assertThat(parseValid(tree).contributions())
                .singleElement()
                .satisfies(contribution -> assertThat(contribution.attributes())
                        .containsEntry("title", "Catalog")
                        .containsKey("i18n"));
    }

    @Test
    @Tag("MK-053")
    void rejectsTextsByLanguageThatTheShellCannotRead() {
        Map<String, Object> tree = validTree();
        tree.put(
                "contributes",
                Map.of(
                        "rail.app",
                        List.of(
                                Map.of("id", "a", "i18n", "Catalogo"),
                                Map.of("id", "b", "i18n", Map.of("Italian", Map.of("title", "Catalogo"))),
                                Map.of("id", "c", "i18n", Map.of("it", Map.of("title", 42))))));

        assertThat(parseInvalid(tree))
                .extracting(ManifestViolation::field)
                .containsExactlyInAnyOrder(
                        "contributes.rail.app[0].i18n",
                        "contributes.rail.app[1].i18n.Italian",
                        "contributes.rail.app[2].i18n.it");
    }

    @Test
    void reportsUnknownKindsAndIsolation() {
        Map<String, Object> tree = validTree();
        tree.put("kind", List.of("app", "widget"));
        tree.put("frontend", Map.of("entry", "web/index.js", "isolation", "worker"));

        assertThat(parseInvalid(tree))
                .extracting(ManifestViolation::field)
                .containsExactlyInAnyOrder("kind", "frontend.isolation");
    }

    @Test
    void reportsSectionsThatAreNotObjects() {
        Map<String, Object> tree = validTree();
        tree.put("frontend", "web/index.js");

        assertThat(parseInvalid(tree)).extracting(ManifestViolation::field).containsExactly("frontend");
    }

    @Test
    void reportsLongNamesUnsafeMigrationsAndInvalidPoints() {
        Map<String, Object> tree = validTree();
        tree.put("name", "n".repeat(81));
        tree.put("database", Map.of("schema", "ext_traffic", "migrations", "../db"));
        tree.put("contributes", Map.of("Launcher App", List.of(Map.of("id", "x"))));

        assertThat(parseInvalid(tree))
                .extracting(ManifestViolation::field)
                .containsExactlyInAnyOrder("name", "database.migrations", "contributes.Launcher App");
    }

    @Test
    void exposesTheNamePlatformAndContributions() {
        ExtensionManifest manifest = parseValid(validTree());

        assertThat(manifest.name()).isNotBlank();
        assertThat(manifest.platform().contains(Version.of(0, 1, 0))).isTrue();
        assertThat(manifest.contributions()).extracting(Contribution::id).containsExactly("traffic");
    }

    @Test
    void anInvalidResultNeedsAViolation() {
        List<ManifestViolation> none = List.of();
        assertThatThrownBy(() -> new ManifestParseResult.Invalid(none)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    @Tag("MK-014")
    void readsTheBridgeOfAnIsolatedFrontend() {
        Map<String, Object> tree = validTree();
        tree.put(
                "frontend",
                Map.of(
                        "entry",
                        "web/index.js",
                        "isolation",
                        "iframe",
                        "bridge",
                        Map.of(
                                "publishes", List.of("traffic.selected"),
                                "subscribes", List.of("maps.*"),
                                "services", List.of("api"))));

        FrontendEntry frontend = parseValid(tree).frontend().orElseThrow();

        assertThat(frontend.isolation()).isEqualTo(FrontendIsolation.IFRAME);
        assertThat(frontend.bridge())
                .isEqualTo(new FrontendBridge(List.of("traffic.selected"), List.of("maps.*"), List.of("api")));
        assertThat(parseValid(validTree()).frontend().orElseThrow().bridge()).isEqualTo(FrontendBridge.NONE);
    }

    @Test
    @Tag("MK-014")
    void reportsInvalidBridges() {
        Map<String, Object> tree = validTree();
        tree.put(
                "frontend",
                Map.of(
                        "entry",
                        "web/index.js",
                        "bridge",
                        Map.of(
                                "publishes",
                                List.of("Not a topic"),
                                "subscribes",
                                "maps.*",
                                "services",
                                List.of("dom"))));

        assertThat(parseInvalid(tree))
                .extracting(ManifestViolation::field)
                .containsExactlyInAnyOrder(
                        "frontend.bridge.publishes[0]", "frontend.bridge.subscribes", "frontend.bridge.services[0]");

        tree.put("frontend", Map.of("entry", "web/index.js", "bridge", "everything"));
        assertThat(parseInvalid(tree)).extracting(ManifestViolation::field).containsExactly("frontend.bridge");
    }

    @Test
    @Tag("MK-015")
    void readsTheActionsOfAExtension() {
        Map<String, Object> tree = validTree();
        tree.put(
                "actions",
                List.of(
                        Map.of(
                                "name", "list-traffic",
                                "title", "List traffic",
                                "risk", "read",
                                "call", Map.of("method", "GET", "path", "traffic")),
                        Map.of(
                                "name", "close-road",
                                "title", "Close a road",
                                "description", "Closes a road to traffic.",
                                "risk", "execute",
                                "input",
                                        Map.of(
                                                "type", "object",
                                                "properties", Map.of("road", Map.of("type", "string")),
                                                "required", List.of("road")),
                                "call", Map.of("method", "post", "path", "roads/{road}/closure"))));

        List<ActionEntry> actions = parseValid(tree).actions();

        assertThat(actions).extracting(ActionEntry::name).containsExactly("list-traffic", "close-road");
        assertThat(actions.get(0).input().tree()).isEqualTo(Map.of("type", "object"));
        assertThat(actions.get(1))
                .extracting(ActionEntry::risk, ActionEntry::method, ActionEntry::path, ActionEntry::description)
                .containsExactly(ActionRisk.EXECUTE, "POST", "roads/{road}/closure", "Closes a road to traffic.");
        assertThat(actions.get(1).input().validate(Map.of())).containsExactly("input.road is required");
        assertThat(ActionRisk.EXECUTE.needsConfirmation()).isTrue();
        assertThat(ActionRisk.READ.needsConfirmation()).isFalse();
        assertThat(ActionRisk.fromValue("write")).contains(ActionRisk.WRITE);
    }

    @Test
    @Tag("MK-015")
    void reportsInvalidActions() {
        Map<String, Object> tree = validTree();
        tree.put(
                "actions",
                List.of(
                        Map.of("name", "Bad Name", "title", "x", "risk", "maybe", "call", Map.of("path", "../x")),
                        Map.of(
                                "name",
                                "read-it",
                                "title",
                                "x",
                                "risk",
                                "read",
                                "call",
                                Map.of("method", "POST", "path", "x")),
                        Map.of(
                                "name",
                                "twice",
                                "title",
                                "x",
                                "risk",
                                "write",
                                "call",
                                Map.of("method", "TRACE", "path", "x?y")),
                        Map.of("name", "twice", "title", "x", "risk", "write", "call", Map.of("path", "x")),
                        Map.of("name", "twice", "title", "x", "risk", "write", "call", Map.of("path", "y")),
                        "not an object"));

        assertThat(parseInvalid(tree))
                .extracting(ManifestViolation::field)
                .contains(
                        "actions[0].name",
                        "actions[0].risk",
                        "actions[0].call.path",
                        "actions[1].call.method",
                        "actions[2].call.method",
                        "actions[2].call.path",
                        "actions",
                        "actions[5]");

        tree.put("actions", "all of them");
        assertThat(parseInvalid(tree)).extracting(ManifestViolation::field).containsExactly("actions");

        tree.remove("backend");
        tree.put(
                "actions",
                List.of(Map.of(
                        "name", "x", "title", "x", "risk", "read", "call", Map.of("method", "GET", "path", "x"))));
        assertThat(parseInvalid(tree))
                .extracting(ManifestViolation::message)
                .anySatisfy(message -> assertThat(message).contains("need a backend"));
    }

    @Test
    @Tag("MK-020")
    void readsTheExtensionPointsOfAFrontend() {
        Map<String, Object> tree = validTree();
        tree.put(
                "frontend",
                Map.of("entry", "web/index.js", "points", List.of("activities.detail", "activities.toolbar")));

        assertThat(parseValid(tree).frontend().orElseThrow().points())
                .containsExactly("activities.detail", "activities.toolbar");

        tree.put(
                "frontend", Map.of("entry", "web/index.js", "points", List.of("launcher.app", "nodots", "a.b", "a.b")));
        assertThat(parseInvalid(tree))
                .extracting(ManifestViolation::field)
                .containsExactly("frontend.points[0]", "frontend.points[1]", "frontend.points[3]");

        tree.put("frontend", Map.of("entry", "web/index.js", "points", "activities.detail"));
        assertThat(parseInvalid(tree)).extracting(ManifestViolation::field).containsExactly("frontend.points");
    }

    @Test
    @Tag("MK-056")
    void readsThePermissionsOfAnExtension() {
        Map<String, Object> tree = validTree();
        tree.put(
                "permissions",
                List.of(
                        Map.of(
                                "name",
                                "create-dashboard",
                                "title",
                                "Create dashboards",
                                "description",
                                "Create new dashboards of the organization",
                                "i18n",
                                Map.of("it", Map.of("title", "Creare cruscotti"))),
                        Map.of("name", "export", "title", "Export")));

        assertThat(parseValid(tree).permissions())
                .containsExactly(
                        new PermissionEntry(
                                "create-dashboard",
                                "Create dashboards",
                                "Create new dashboards of the organization",
                                Map.of("it", Map.of("title", "Creare cruscotti"))),
                        new PermissionEntry("export", "Export", null, null));
        assertThat(parseValid(validTree()).permissions()).isEmpty();
    }

    @Test
    @Tag("MK-056")
    void rejectsPermissionsThatTheProfileEditorCannotShow() {
        Map<String, Object> tree = validTree();
        tree.put(
                "permissions",
                List.of(
                        Map.of("name", "Create Dashboard", "title", "x"),
                        Map.of("name", "export"),
                        Map.of("name", "twice", "title", "x"),
                        Map.of("name", "twice", "title", "y"),
                        Map.of("name", "label", "title", "x", "i18n", Map.of("it", Map.of("icon", "x"))),
                        Map.of("name", "texts", "title", "x", "i18n", Map.of("Italian", Map.of("title", "x"))),
                        "not an object"));

        assertThat(parseInvalid(tree))
                .extracting(ManifestViolation::field)
                .containsExactlyInAnyOrder(
                        "permissions[0].name",
                        "permissions[1].title",
                        "permissions[3].name",
                        "permissions[4].i18n.it.icon",
                        "permissions[5].i18n.Italian",
                        "permissions[6]");

        tree.put("permissions", "all of them");
        assertThat(parseInvalid(tree)).extracting(ManifestViolation::field).containsExactly("permissions");
    }

    @Test
    @Tag("MK-055")
    void readsTheResourceTypesAndTheirSharingLevels() {
        Map<String, Object> tree = validTree();
        tree.put(
                "resources",
                List.of(
                        Map.of(
                                "type",
                                "dashboard",
                                "title",
                                "Dashboard",
                                "i18n",
                                Map.of("it", Map.of("title", "Cruscotto")),
                                "levels",
                                List.of(
                                        Map.of(
                                                "name",
                                                "view",
                                                "title",
                                                "View",
                                                "i18n",
                                                Map.of("it", Map.of("title", "Vedere"))),
                                        Map.of("name", "edit", "title", "Edit"),
                                        Map.of("name", "manage", "title", "Manage")),
                                "subjects",
                                List.of("person", "group", "organization", "link")),
                        Map.of(
                                "type",
                                "folder",
                                "title",
                                "Folder",
                                "levels",
                                List.of(Map.of("name", "view", "title", "View")))));

        ExtensionManifest manifest = parseValid(tree);

        ResourceTypeEntry dashboard = manifest.resourceType("dashboard").orElseThrow();
        assertThat(dashboard.title()).isEqualTo("Dashboard");
        assertThat(dashboard.i18n()).containsEntry("it", Map.of("title", "Cruscotto"));
        assertThat(dashboard.levelNames()).containsExactly("view", "edit", "manage");
        assertThat(dashboard.levels().getFirst().i18n()).containsEntry("it", Map.of("title", "Vedere"));
        assertThat(dashboard.declares("edit")).isTrue();
        assertThat(dashboard.declares("own")).isFalse();
        assertThat(dashboard.includes("manage", "view")).isTrue();
        assertThat(dashboard.includes("edit", "edit")).isTrue();
        assertThat(dashboard.includes("view", "edit")).isFalse();
        assertThat(dashboard.includes("own", "view")).isFalse();
        assertThat(dashboard.includes("view", "own")).isFalse();
        assertThat(dashboard.accepts(SubjectKind.LINK)).isTrue();
        assertThat(dashboard.accepts(SubjectKind.PUBLIC)).isFalse();
        assertThat(manifest.resourceType("folder").orElseThrow().subjects()).isEqualTo(SubjectKind.DEFAULT);
        assertThat(manifest.resourceType("chart")).isEmpty();
        assertThat(parseValid(validTree()).resourceTypes()).isEmpty();
    }

    @Test
    @Tag("MK-054")
    @Tag("MK-055")
    void rejectsResourceTypesThatTheKernelCannotShare() {
        Map<String, Object> tree = validTree();
        Map<String, Object> view = Map.of("name", "view", "title", "View");
        tree.put(
                "resources",
                List.of(
                        Map.of("type", "Dashboard", "title", "x", "levels", List.of(view)),
                        Map.of("type", "no-levels", "title", "x"),
                        Map.of("type", "empty-levels", "title", "x", "levels", List.of()),
                        Map.of(
                                "type",
                                "bad-levels",
                                "title",
                                "x",
                                "levels",
                                List.of(
                                        view,
                                        Map.of("name", "view", "title", "Again"),
                                        Map.of("name", "Edit", "title", "x"),
                                        Map.of("name", "manage"),
                                        "not an object")),
                        Map.of(
                                "type",
                                "bad-subjects",
                                "title",
                                "x",
                                "levels",
                                List.of(view),
                                "subjects",
                                List.of("person", "everyone", "person")),
                        Map.of("type", "no-subjects", "title", "x", "levels", List.of(view), "subjects", List.of()),
                        Map.of("type", "twice", "title", "x", "levels", List.of(view)),
                        Map.of("type", "twice", "title", "y", "levels", List.of(view)),
                        Map.of("title", "x", "levels", List.of(view), "i18n", Map.of("it", Map.of("description", "x"))),
                        "not an object"));

        assertThat(parseInvalid(tree))
                .extracting(ManifestViolation::field)
                .containsExactlyInAnyOrder(
                        "resources[0].type",
                        "resources[1].levels",
                        "resources[2].levels",
                        "resources[3].levels[1].name",
                        "resources[3].levels[2].name",
                        "resources[3].levels[3].title",
                        "resources[3].levels[4]",
                        "resources[4].subjects[1]",
                        "resources[4].subjects[2]",
                        "resources[5].subjects",
                        "resources[7].type",
                        "resources[8].type",
                        "resources[8].i18n.it.description",
                        "resources[9]");

        tree.put("resources", Map.of("dashboard", view));
        assertThat(parseInvalid(tree)).extracting(ManifestViolation::field).containsExactly("resources");
    }

    @Test
    @Tag("MK-055")
    void aResourceTypeHasAtLeastOneLevel() {
        List<SharingLevelEntry> none = List.of();
        Set<SubjectKind> subjects = SubjectKind.DEFAULT;

        assertThatThrownBy(() -> new ResourceTypeEntry("dashboard", "Dashboard", none, subjects, null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
