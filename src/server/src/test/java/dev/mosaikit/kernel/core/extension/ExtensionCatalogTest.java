// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

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
class ExtensionCatalogTest {

    @TempDir
    Path extensions;

    private final ExtensionCatalog catalog = new ExtensionCatalog(Version.parse("0.3.0-SNAPSHOT"));

    private void install(String directory, String manifest) throws IOException {
        Path root = Files.createDirectories(extensions.resolve(directory));
        Files.writeString(root.resolve(ExtensionCatalog.MANIFEST_FILE), manifest);
    }

    private static String manifest(String id, String version, String platform, String requires) {
        return """
                id: %s
                version: %s
                name: Test extension
                kind: [extension]
                platform: "%s"
                %s
                """.formatted(id, version, platform, requires);
    }

    private InstalledExtension find(List<InstalledExtension> found, String key) {
        return found.stream()
                .filter(extension -> extension.key().equals(key))
                .findFirst()
                .orElseThrow();
    }

    @Test
    void returnsNothingWhenTheDirectoryDoesNotExist() {
        assertThat(catalog.scan(extensions.resolve("missing"))).isEmpty();
    }

    @Test
    void activatesCompatibleExtensionsIgnoringTheKernelPreRelease() throws IOException {
        install("hello", manifest("dev.example.hello", "1.0.0", ">=0.3 <1", ""));

        assertThat(catalog.scan(extensions)).singleElement().satisfies(extension -> {
            assertThat(extension.key()).isEqualTo("dev.example.hello");
            assertThat(extension.status()).isEqualTo(ExtensionStatus.ACTIVE);
            assertThat(extension.problems()).isEmpty();
        });
    }

    @Test
    void marksExtensionsForAnotherKernelAsIncompatible() throws IOException {
        install("future", manifest("dev.example.future", "1.0.0", ">=2", ""));

        InstalledExtension extension = find(catalog.scan(extensions), "dev.example.future");

        assertThat(extension.status()).isEqualTo(ExtensionStatus.INCOMPATIBLE);
        assertThat(extension.problems()).singleElement().asString().contains(">=2");
    }

    @Test
    void reportsMissingAndInvalidManifestsWithTheDirectoryName() throws IOException {
        Files.createDirectories(extensions.resolve("empty"));
        install("broken", "id: [unclosed");
        install("wrong", "id: Wrong\n");

        List<InstalledExtension> found = catalog.scan(extensions);

        assertThat(found).extracting(InstalledExtension::status).containsOnly(ExtensionStatus.INVALID);
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

        List<InstalledExtension> found = catalog.scan(extensions);

        assertThat(find(found, "dev.example.traffic").status()).isEqualTo(ExtensionStatus.ACTIVE);
        assertThat(find(found, "dev.example.forecast").status()).isEqualTo(ExtensionStatus.INCOMPATIBLE);
        assertThat(find(found, "dev.example.chain").status()).isEqualTo(ExtensionStatus.INCOMPATIBLE);
        assertThat(find(found, "dev.example.chain").problems())
                .singleElement()
                .asString()
                .contains("dev.example.forecast");
    }

    @Test
    void rejectsARequirementInTheWrongVersion() throws IOException {
        install("a-base", manifest("dev.example.base", "1.4.0", ">=0.1", ""));
        install("b-user", manifest("dev.example.user", "1.0.0", ">=0.1", "requires: {dev.example.base: \"^2\"}"));

        InstalledExtension extension = find(catalog.scan(extensions), "dev.example.user");

        assertThat(extension.status()).isEqualTo(ExtensionStatus.INCOMPATIBLE);
        assertThat(extension.problems()).singleElement().asString().contains("found 1.4.0");
    }

    @Test
    @Tag("MK-132")
    void explainsACopiedExtensionWithoutItsRequirementAsTheMarketplaceRefusesIt() throws IOException {
        install("a-base", manifest("dev.example.base", "1.4.0", ">=0.1", ""));
        install("b-user", manifest("dev.example.user", "1.0.0", ">=0.1", "requires: {dev.example.base: \"^2\"}"));
        install("c-other", manifest("dev.example.other", "1.0.0", ">=0.1", "requires: {dev.example.gone: \"^1\"}"));

        List<InstalledExtension> found = catalog.scan(extensions);
        InstalledExtension user = find(found, "dev.example.user");
        InstalledExtension other = find(found, "dev.example.other");

        assertThat(user.status()).isEqualTo(ExtensionStatus.INCOMPATIBLE);
        assertThat(user.problems()).containsExactly("Requires extension dev.example.base ^2, found 1.4.0");
        assertThat(other.problems()).containsExactly("Requires extension dev.example.gone ^1, which is not installed");
        // The marketplace gives the same explanation when it refuses to install them.
        ExtensionDependencies installed = ExtensionDependencies.installed(found.stream()
                .filter(extension -> extension.key().equals("dev.example.base"))
                .toList());
        assertThat(installed.refuseInstallation(List.of(user.manifest().orElseThrow())))
                .containsExactly("dev.example.user 1.0.0: " + user.problems().getFirst());
        assertThat(installed.refuseInstallation(List.of(other.manifest().orElseThrow())))
                .containsExactly("dev.example.other 1.0.0: " + other.problems().getFirst());
    }

    @Test
    @Tag("MK-132")
    void startsAnExtensionWhoseOptionalDependencyIsMissingOrInAnotherVersion() throws IOException {
        install("a-base", manifest("dev.example.base", "1.4.0", ">=0.1", ""));
        install(
                "b-viewer",
                manifest(
                        "dev.example.viewer",
                        "1.0.0",
                        ">=0.1",
                        "optional: {dev.example.base: \"^2\", dev.example.maps: \"^3\"}"));

        InstalledExtension viewer = find(catalog.scan(extensions), "dev.example.viewer");

        assertThat(viewer.status()).isEqualTo(ExtensionStatus.ACTIVE);
        assertThat(viewer.problems()).isEmpty();
    }

    @Test
    void keepsTheFirstOfTwoExtensionsWithTheSameId() throws IOException {
        install("first", manifest("dev.example.twin", "1.0.0", ">=0.1", ""));
        install("second", manifest("dev.example.twin", "2.0.0", ">=0.1", ""));

        List<InstalledExtension> found = catalog.scan(extensions);

        assertThat(found).hasSize(2);
        assertThat(found)
                .filteredOn(InstalledExtension::isActive)
                .singleElement()
                .satisfies(extension ->
                        assertThat(extension.directory().getFileName()).hasToString("first"));
        assertThat(found)
                .filteredOn(extension -> extension.status() == ExtensionStatus.INVALID)
                .singleElement()
                .satisfies(extension ->
                        assertThat(extension.problems()).first().asString().startsWith("Duplicate"));
    }

    private void installJavaExtension(String directory, String id, byte[] jar) throws IOException {
        install(directory, manifest(id, "1.0.0", ">=0.3 <1", "backend:\n  jar: lib/code.jar\n  api: " + directory));
        if (jar != null) {
            Path lib = Files.createDirectories(extensions.resolve(directory).resolve("lib"));
            Files.write(lib.resolve("code.jar"), jar);
        }
    }

    @Test
    @Tag("MK-011")
    void refusesJavaExtensionsWhoseDeclaredJarIsMissing() throws IOException {
        installJavaExtension("notes", "dev.example.notes", null);

        InstalledExtension extension = find(catalog.scan(extensions), "dev.example.notes");

        assertThat(extension.status()).isEqualTo(ExtensionStatus.INVALID);
        assertThat(extension.problems()).singleElement().asString().contains("code.jar");
    }

    @Test
    @Tag("MK-011")
    void activatesJavaExtensionsOnlyWhenTheirExactJarIsLoaded() throws IOException {
        installJavaExtension("notes", "dev.example.notes", "version one".getBytes(UTF_8));
        Path jar = extensions.resolve("notes/lib/code.jar");
        ProviderState loaded =
                new ProviderState(List.of(new ProviderState.Entry(ProviderState.sha256(jar), "dev.example.notes")));
        ExtensionCatalog kernel = new ExtensionCatalog(
                Version.parse("0.3.0"), BackendCheck.loadedBy(loaded, new ProviderState(List.of())));

        assertThat(find(kernel.scan(extensions), "dev.example.notes").status()).isEqualTo(ExtensionStatus.ACTIVE);

        Files.writeString(jar, "version two");
        InstalledExtension changed = find(kernel.scan(extensions), "dev.example.notes");
        assertThat(changed.status()).isEqualTo(ExtensionStatus.RESTART_REQUIRED);
        assertThat(changed.problems()).singleElement().asString().contains("the mosaikit launcher");
    }

    @Test
    @Tag("MK-011")
    void disablesExtensionsThatRequireAJavaExtensionWaitingForARestart() throws IOException {
        installJavaExtension("notes", "dev.example.notes", "code".getBytes(UTF_8));
        install("board", manifest("dev.example.board", "1.0.0", ">=0.3 <1", "requires:\n  dev.example.notes: \"^1\""));
        ExtensionCatalog kernel = new ExtensionCatalog(Version.parse("0.3.0"), BackendCheck.notLoaded());

        List<InstalledExtension> found = kernel.scan(extensions);

        assertThat(find(found, "dev.example.notes").status()).isEqualTo(ExtensionStatus.RESTART_REQUIRED);
        assertThat(find(found, "dev.example.board").status()).isEqualTo(ExtensionStatus.INCOMPATIBLE);
    }

    @Test
    @Tag("MK-011")
    void refusesJarsThatWereRolledBack() throws IOException {
        installJavaExtension("notes", "dev.example.notes", "broken".getBytes(UTF_8));
        Path jar = extensions.resolve("notes/lib/code.jar");
        ProviderState rejected =
                new ProviderState(List.of(new ProviderState.Entry(ProviderState.sha256(jar), "dev.example.notes")));

        InstalledExtension extension = find(
                new ExtensionCatalog(Version.parse("0.3.0"), BackendCheck.available(rejected)).scan(extensions),
                "dev.example.notes");

        assertThat(extension.status()).isEqualTo(ExtensionStatus.INVALID);
        assertThat(extension.problems()).singleElement().asString().startsWith("Rolled back");
    }

    @Test
    @Tag("MK-011")
    void keepsTheFirstOfTwoExtensionsWithTheSameApiName() throws IOException {
        installJavaExtension("notes", "dev.example.notes", "a".getBytes(UTF_8));
        install(
                "other",
                manifest("dev.example.other", "1.0.0", ">=0.3 <1", "backend:\n  jar: lib/code.jar\n  api: notes"));
        Files.createDirectories(extensions.resolve("other/lib"));
        Files.writeString(extensions.resolve("other/lib/code.jar"), "b");

        List<InstalledExtension> found = catalog.scan(extensions);

        assertThat(find(found, "dev.example.notes").status()).isEqualTo(ExtensionStatus.ACTIVE);
        assertThat(find(found, "dev.example.other").problems())
                .singleElement()
                .asString()
                .contains("already used");
    }
}
