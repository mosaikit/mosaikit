// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.api.version.Version;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

@Tag("MK-006")
class PluginCatalogTest {

    @TempDir
    Path plugins;

    private final PluginCatalog catalog = new PluginCatalog(Version.parse("0.3.0-SNAPSHOT"));

    private void install(String directory, String manifest) throws IOException {
        Path root = Files.createDirectories(plugins.resolve(directory));
        Files.writeString(root.resolve(PluginCatalog.MANIFEST_FILE), manifest);
    }

    private static String manifest(String id, String version, String platform, String requires) {
        return """
                id: %s
                version: %s
                name: Test plugin
                kind: [extension]
                platform: "%s"
                %s
                """.formatted(id, version, platform, requires);
    }

    private InstalledPlugin find(List<InstalledPlugin> found, String key) {
        return found.stream()
                .filter(plugin -> plugin.key().equals(key))
                .findFirst()
                .orElseThrow();
    }

    @Test
    void returnsNothingWhenTheDirectoryDoesNotExist() {
        assertThat(catalog.scan(plugins.resolve("missing"))).isEmpty();
    }

    @Test
    void activatesCompatiblePluginsIgnoringTheKernelPreRelease() throws IOException {
        install("hello", manifest("dev.example.hello", "1.0.0", ">=0.3 <1", ""));

        assertThat(catalog.scan(plugins)).singleElement().satisfies(plugin -> {
            assertThat(plugin.key()).isEqualTo("dev.example.hello");
            assertThat(plugin.status()).isEqualTo(PluginStatus.ACTIVE);
            assertThat(plugin.problems()).isEmpty();
        });
    }

    @Test
    void marksPluginsForAnotherKernelAsIncompatible() throws IOException {
        install("future", manifest("dev.example.future", "1.0.0", ">=2", ""));

        InstalledPlugin plugin = find(catalog.scan(plugins), "dev.example.future");

        assertThat(plugin.status()).isEqualTo(PluginStatus.INCOMPATIBLE);
        assertThat(plugin.problems()).singleElement().asString().contains(">=2");
    }

    @Test
    void reportsMissingAndInvalidManifestsWithTheDirectoryName() throws IOException {
        Files.createDirectories(plugins.resolve("empty"));
        install("broken", "id: [unclosed");
        install("wrong", "id: Wrong\n");

        List<InstalledPlugin> found = catalog.scan(plugins);

        assertThat(found).extracting(InstalledPlugin::status).containsOnly(PluginStatus.INVALID);
        assertThat(find(found, "empty").problems()).containsExactly("Missing manifest.yaml");
        assertThat(find(found, "broken").problems()).singleElement().asString().startsWith("Unreadable");
        assertThat(find(found, "wrong").problems()).anyMatch(problem -> problem.startsWith("id:"));
    }

    @Test
    void resolvesRequirementsTransitively() throws IOException {
        install("a-base", manifest("dev.example.base", "2.1.0", ">=0.1", ""));
        install("b-maps", manifest("dev.example.maps", "3.0.0", ">=0.1", "requires: {dev.example.base: \"^2\"}"));
        install("c-traffic", manifest("dev.example.traffic", "1.0.0", ">=0.1", "requires: {dev.example.maps: \"^3\"}"));
        install(
                "d-forecast",
                manifest("dev.example.forecast", "1.0.0", ">=0.1", "requires: {dev.example.missing: \"^1\"}"));
        install("e-chain", manifest("dev.example.chain", "1.0.0", ">=0.1", "requires: {dev.example.forecast: \"^1\"}"));

        List<InstalledPlugin> found = catalog.scan(plugins);

        assertThat(find(found, "dev.example.traffic").status()).isEqualTo(PluginStatus.ACTIVE);
        assertThat(find(found, "dev.example.forecast").status()).isEqualTo(PluginStatus.INCOMPATIBLE);
        assertThat(find(found, "dev.example.chain").status()).isEqualTo(PluginStatus.INCOMPATIBLE);
        assertThat(find(found, "dev.example.chain").problems())
                .singleElement()
                .asString()
                .contains("dev.example.forecast");
    }

    @Test
    void rejectsARequirementInTheWrongVersion() throws IOException {
        install("a-base", manifest("dev.example.base", "1.4.0", ">=0.1", ""));
        install("b-user", manifest("dev.example.user", "1.0.0", ">=0.1", "requires: {dev.example.base: \"^2\"}"));

        InstalledPlugin plugin = find(catalog.scan(plugins), "dev.example.user");

        assertThat(plugin.status()).isEqualTo(PluginStatus.INCOMPATIBLE);
        assertThat(plugin.problems()).singleElement().asString().contains("found 1.4.0");
    }

    @Test
    void keepsTheFirstOfTwoPluginsWithTheSameId() throws IOException {
        install("first", manifest("dev.example.twin", "1.0.0", ">=0.1", ""));
        install("second", manifest("dev.example.twin", "2.0.0", ">=0.1", ""));

        List<InstalledPlugin> found = catalog.scan(plugins);

        assertThat(found).hasSize(2);
        assertThat(found)
                .filteredOn(InstalledPlugin::isActive)
                .singleElement()
                .satisfies(
                        plugin -> assertThat(plugin.directory().getFileName()).hasToString("first"));
        assertThat(found)
                .filteredOn(plugin -> plugin.status() == PluginStatus.INVALID)
                .singleElement()
                .satisfies(plugin ->
                        assertThat(plugin.problems()).first().asString().startsWith("Duplicate"));
    }

    private void installJavaPlugin(String directory, String id, byte[] jar) throws IOException {
        install(directory, manifest(id, "1.0.0", ">=0.3 <1", "backend:\n  jar: lib/code.jar\n  api: " + directory));
        if (jar != null) {
            Path lib = Files.createDirectories(plugins.resolve(directory).resolve("lib"));
            Files.write(lib.resolve("code.jar"), jar);
        }
    }

    @Test
    @Tag("MK-011")
    void refusesJavaPluginsWhoseDeclaredJarIsMissing() throws IOException {
        installJavaPlugin("notes", "dev.example.notes", null);

        InstalledPlugin plugin = find(catalog.scan(plugins), "dev.example.notes");

        assertThat(plugin.status()).isEqualTo(PluginStatus.INVALID);
        assertThat(plugin.problems()).singleElement().asString().contains("code.jar");
    }

    @Test
    @Tag("MK-011")
    void activatesJavaPluginsOnlyWhenTheirExactJarIsLoaded() throws IOException {
        installJavaPlugin("notes", "dev.example.notes", "version one".getBytes(UTF_8));
        Path jar = plugins.resolve("notes/lib/code.jar");
        ProviderState loaded =
                new ProviderState(List.of(new ProviderState.Entry(ProviderState.sha256(jar), "dev.example.notes")));
        PluginCatalog kernel =
                new PluginCatalog(Version.parse("0.3.0"), BackendCheck.loadedBy(loaded, new ProviderState(List.of())));

        assertThat(find(kernel.scan(plugins), "dev.example.notes").status()).isEqualTo(PluginStatus.ACTIVE);

        Files.writeString(jar, "version two");
        InstalledPlugin changed = find(kernel.scan(plugins), "dev.example.notes");
        assertThat(changed.status()).isEqualTo(PluginStatus.RESTART_REQUIRED);
        assertThat(changed.problems()).singleElement().asString().contains("the mosaikit launcher");
    }

    @Test
    @Tag("MK-011")
    void disablesPluginsThatRequireAJavaPluginWaitingForARestart() throws IOException {
        installJavaPlugin("notes", "dev.example.notes", "code".getBytes(UTF_8));
        install("board", manifest("dev.example.board", "1.0.0", ">=0.3 <1", "requires:\n  dev.example.notes: \"^1\""));
        PluginCatalog kernel = new PluginCatalog(Version.parse("0.3.0"), BackendCheck.notLoaded());

        List<InstalledPlugin> found = kernel.scan(plugins);

        assertThat(find(found, "dev.example.notes").status()).isEqualTo(PluginStatus.RESTART_REQUIRED);
        assertThat(find(found, "dev.example.board").status()).isEqualTo(PluginStatus.INCOMPATIBLE);
    }

    @Test
    @Tag("MK-011")
    void refusesJarsThatWereRolledBack() throws IOException {
        installJavaPlugin("notes", "dev.example.notes", "broken".getBytes(UTF_8));
        Path jar = plugins.resolve("notes/lib/code.jar");
        ProviderState rejected =
                new ProviderState(List.of(new ProviderState.Entry(ProviderState.sha256(jar), "dev.example.notes")));

        InstalledPlugin plugin = find(
                new PluginCatalog(Version.parse("0.3.0"), BackendCheck.available(rejected)).scan(plugins),
                "dev.example.notes");

        assertThat(plugin.status()).isEqualTo(PluginStatus.INVALID);
        assertThat(plugin.problems()).singleElement().asString().startsWith("Rolled back");
    }

    @Test
    @Tag("MK-011")
    void keepsTheFirstOfTwoPluginsWithTheSameApiName() throws IOException {
        installJavaPlugin("notes", "dev.example.notes", "a".getBytes(UTF_8));
        install(
                "other",
                manifest("dev.example.other", "1.0.0", ">=0.3 <1", "backend:\n  jar: lib/code.jar\n  api: notes"));
        Files.createDirectories(plugins.resolve("other/lib"));
        Files.writeString(plugins.resolve("other/lib/code.jar"), "b");

        List<InstalledPlugin> found = catalog.scan(plugins);

        assertThat(find(found, "dev.example.notes").status()).isEqualTo(PluginStatus.ACTIVE);
        assertThat(find(found, "dev.example.other").problems())
                .singleElement()
                .asString()
                .contains("already used");
    }
}
