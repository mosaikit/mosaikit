// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.launcher;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.api.version.Version;
import dev.mosaikit.kernel.core.extension.BackendCheck;
import dev.mosaikit.kernel.core.extension.ExtensionCatalog;
import dev.mosaikit.kernel.core.extension.ExtensionStatus;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.extension.KernelLibraries;
import dev.mosaikit.kernel.core.extension.PackageTrust;
import dev.mosaikit.kernel.core.extension.ProviderState;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The API artifact of a contract between extensions is loaded once, in the highest of the compatible
 * versions that the extensions bring (MK-134, with the libraries of MK-131).
 */
@Tag("MK-134")
class LauncherContractApisTest {

    private static final Version KERNEL = Version.parse("0.1.0");
    private static final String API = "org.example:catalog-api";

    @TempDir
    Path home;

    private Installation installation;
    private final ByteArrayOutputStream output = new ByteArrayOutputStream();
    private final AtomicInteger rebuilds = new AtomicInteger();

    @BeforeEach
    void createInstallation() throws IOException {
        installation = new Installation(home);
        Files.createDirectories(installation.providers());
        Files.createDirectories(installation.kernel().resolve("quarkus"));
        Files.writeString(installation.kernelJar(), "kernel");
        Files.createDirectories(installation.extensions());
    }

    private void prepare() throws IOException {
        output.reset();
        var launcher = new Launcher(
                new PrintStream(output, true, UTF_8),
                ignored -> {
                    rebuilds.incrementAndGet();
                    return 0;
                },
                PackageTrust.none(),
                KernelLibraries.none());
        assertThat(launcher.prepare(installation, KERNEL, true)).isZero();
        Files.deleteIfExists(installation.providers().resolve(ProviderState.PENDING_FILE));
    }

    /**
     * A Java extension that brings the API artifact of the catalog in a version: the catalog provides
     * the contract, the others implement it.
     */
    private void install(String name, String apiVersion, String contracts) throws IOException {
        Path root = installation.extensions().resolve(name);
        Files.createDirectories(root.resolve("lib"));
        Files.writeString(root.resolve("lib/code.jar"), "code of " + name);
        String file = "lib/catalog-api-" + apiVersion + ".jar";
        Path jar = root.resolve(file);
        try (OutputStream out = Files.newOutputStream(jar);
                ZipOutputStream zip = new ZipOutputStream(out)) {
            zip.putNextEntry(new ZipEntry("org/example/catalog/api/Connector.class"));
            zip.write(apiVersion.getBytes(UTF_8));
            zip.closeEntry();
        }
        Files.writeString(root.resolve("manifest.yaml"), """
                id: org.example.%s
                version: 1.0.0
                name: Test
                kind: [service]
                platform: ">=0.1"
                backend:
                  jar: lib/code.jar
                  api: %s
                libraries:
                  - jar: "%s"
                    coordinates: "%s:%s"
                    sha256: "%s"
                contracts:
                %s
                """.formatted(
                        name, name, file, API, apiVersion, ProviderState.sha256(jar), contracts));
    }

    private void owner(String apiVersion) throws IOException {
        install("catalog", apiVersion, "  provides: [{ name: connector, versions: [1], api: \"" + API + "\" }]");
    }

    private void connector(String name, String apiVersion) throws IOException {
        install(
                name,
                apiVersion,
                "  implements: [{ contract: org.example.catalog/connector, version: 1, api: \"" + API + "\" }]");
    }

    private List<String> providers() throws IOException {
        try (Stream<Path> files = Files.list(installation.providers())) {
            return files.map(file -> file.getFileName().toString())
                    .filter(name -> name.endsWith(".jar"))
                    .sorted()
                    .toList();
        }
    }

    private List<InstalledExtension> kernelView() {
        ProviderState state = ProviderState.read(installation.providers());
        return new ExtensionCatalog(
                        KERNEL,
                        BackendCheck.loadedBy(state, new ProviderState(List.of()), KernelLibraries.none()),
                        PackageTrust.none(),
                        KernelLibraries.none(),
                        state.extensionIds())
                .scan(installation.extensions(), installation.packages());
    }

    @Test
    void loadsTheHighestCompatibleVersionOfAnApiArtifactOnce() throws IOException {
        owner("1.2.0");
        connector("files", "1.4.0");
        connector("web", "1.2.0");

        prepare();

        assertThat(providers())
                .as("one copy of the API artifact, the highest of the compatible ones")
                .containsExactly(
                        "org.example.catalog.jar",
                        "org.example.files.jar",
                        "org.example.web.jar",
                        "org.example_catalog-api_1.4.0.jar");
        assertThat(ProviderState.read(installation.providers()).entries())
                .extracting(ProviderState.Entry::extensionId)
                .contains("library:" + API + ":1.4.0")
                .doesNotContain("library:" + API + ":1.2.0");
        assertThat(kernelView())
                .as("the kernel runs the extensions that brought a lower compatible version")
                .allSatisfy(extension -> assertThat(extension.status()).isEqualTo(ExtensionStatus.ACTIVE));

        prepare();
        assertThat(rebuilds).as("nothing changed").hasValue(1);
    }

    @Test
    void refusesAnotherMajorVersionOfTheApiArtifactAndSaysWhy() throws IOException {
        owner("1.2.0");
        connector("files", "1.2.0");
        prepare();

        connector("web", "2.0.0");
        prepare();

        assertThat(rebuilds).as("web is not loaded").hasValue(1);
        assertThat(output.toString(UTF_8))
                .contains("org.example.web is INCOMPATIBLE")
                .contains("API artifact " + API + " 2.0.0 conflicts with version 1.2.0 brought by extension"
                        + " org.example.catalog");
        assertThat(providers()).contains("org.example_catalog-api_1.2.0.jar").doesNotContain("org.example.web.jar");
    }
}
