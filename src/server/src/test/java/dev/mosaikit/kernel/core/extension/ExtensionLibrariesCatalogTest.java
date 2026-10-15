// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.api.extension.LibraryEntry;
import dev.mosaikit.kernel.api.version.Version;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The checks of the libraries that Java extensions bring, by the launcher and the kernel (MK-131). */
@Tag("MK-131")
class ExtensionLibrariesCatalogTest {

    private static final Version KERNEL = Version.parse("0.3.0");

    /** The kernel of these tests provides org.example:shared 1.0. */
    private static final KernelLibraries KERNEL_LIBRARIES =
            KernelLibraries.of(List.of(new KernelLibraries.Library("org.example", "shared", "", "1.0")));

    @TempDir
    Path extensions;

    /** A library: a JAR with one class whose content tells the versions apart. */
    record Library(String artifactId, String version, boolean quarkusExtension) {

        Library(String artifactId, String version) {
            this(artifactId, version, false);
        }

        String file() {
            return "lib/" + artifactId + "-" + version + ".jar";
        }
    }

    /** Installs a Java extension with its libraries, listed in its manifest as the parent POM writes them. */
    static Path install(Path extensions, String name, Library... libraries) throws IOException {
        Path root =
                Files.createDirectories(extensions.resolve(name).resolve("lib")).getParent();
        Files.writeString(root.resolve("lib/code.jar"), "code of " + name);
        StringBuilder manifest = new StringBuilder("""
                id: dev.example.%s
                version: 1.0.0
                name: Test
                kind: [service]
                platform: ">=0.1"
                backend:
                  jar: lib/code.jar
                  api: %s
                """.formatted(name, name));
        if (libraries.length > 0) {
            manifest.append("libraries:\n");
        }
        for (Library library : libraries) {
            Path jar = root.resolve(library.file());
            try (OutputStream out = Files.newOutputStream(jar);
                    ZipOutputStream zip = new ZipOutputStream(out)) {
                zip.putNextEntry(new ZipEntry("org/example/" + library.artifactId() + ".class"));
                zip.write(library.version().getBytes(UTF_8));
                zip.closeEntry();
                if (library.quarkusExtension()) {
                    zip.putNextEntry(new ZipEntry("META-INF/quarkus-extension.properties"));
                    zip.closeEntry();
                }
            }
            manifest.append("  - jar: \"%s\"\n    coordinates: \"org.example:%s:%s\"\n    sha256: \"%s\"\n"
                    .formatted(library.file(), library.artifactId(), library.version(), ProviderState.sha256(jar)));
        }
        Files.writeString(root.resolve(ExtensionCatalog.MANIFEST_FILE), manifest.toString());
        return root;
    }

    private List<InstalledExtension> scan(Set<String> loaded) {
        return new ExtensionCatalog(KERNEL, BackendCheck.jarExists(), PackageTrust.none(), KERNEL_LIBRARIES, loaded)
                .scan(extensions);
    }

    private static InstalledExtension find(List<InstalledExtension> found, String name) {
        return found.stream()
                .filter(extension -> extension.key().equals("dev.example." + name))
                .findFirst()
                .orElseThrow();
    }

    @Test
    void acceptsLibrariesTheKernelDoesNotHaveOrHasInTheSameVersion() throws IOException {
        install(extensions, "catalog", new Library("parser", "1.2.0"), new Library("shared", "1.0"));

        InstalledExtension catalog = find(scan(Set.of()), "catalog");

        assertThat(catalog.status()).isEqualTo(ExtensionStatus.ACTIVE);
        assertThat(catalog.manifest().orElseThrow().libraries())
                .extracting(LibraryEntry::coordinates)
                .containsExactly("org.example:parser:1.2.0", "org.example:shared:1.0");
    }

    @Test
    void refusesALibraryThatTheKernelProvidesInAnotherVersion() throws IOException {
        install(extensions, "catalog", new Library("shared", "2.0"));

        InstalledExtension catalog = find(scan(Set.of()), "catalog");

        assertThat(catalog.status()).isEqualTo(ExtensionStatus.INCOMPATIBLE);
        assertThat(catalog.problems())
                .singleElement()
                .asString()
                .contains("org.example:shared 2.0 conflicts with the kernel, which provides version 1.0");
    }

    @Test
    void refusesALibraryThatAnotherExtensionBringsInAnotherVersion() throws IOException {
        install(extensions, "alpha", new Library("parser", "1.2.0"));
        install(extensions, "beta", new Library("parser", "2.0.0"));
        install(extensions, "gamma", new Library("parser", "1.2.0"));

        List<InstalledExtension> found = scan(Set.of());

        assertThat(find(found, "alpha").status()).isEqualTo(ExtensionStatus.ACTIVE);
        assertThat(find(found, "gamma").status())
                .as("the same library in the same version")
                .isEqualTo(ExtensionStatus.ACTIVE);
        assertThat(find(found, "beta").status()).isEqualTo(ExtensionStatus.INCOMPATIBLE);
        assertThat(find(found, "beta").problems())
                .singleElement()
                .asString()
                .contains(
                        "org.example:parser 2.0.0 conflicts with version 1.2.0 brought by extension dev.example.alpha");
    }

    @Test
    void theExtensionTheKernelRunsKeepsItsLibrary() throws IOException {
        install(extensions, "alpha", new Library("parser", "1.2.0"));
        install(extensions, "beta", new Library("parser", "2.0.0"));

        List<InstalledExtension> found = scan(Set.of("dev.example.beta"));

        assertThat(find(found, "beta").status()).isEqualTo(ExtensionStatus.ACTIVE);
        assertThat(find(found, "alpha").problems())
                .singleElement()
                .asString()
                .contains(
                        "org.example:parser 1.2.0 conflicts with version 2.0.0 brought by extension dev.example.beta");
    }

    @Test
    void anExtensionThatRequiresARefusedOneIsIncompatibleToo() throws IOException {
        install(extensions, "alpha", new Library("shared", "3.0"));
        Path beta = install(extensions, "beta");
        Files.writeString(
                beta.resolve(ExtensionCatalog.MANIFEST_FILE),
                Files.readString(beta.resolve(ExtensionCatalog.MANIFEST_FILE))
                        + "requires:\n  dev.example.alpha: \"^1\"\n");

        List<InstalledExtension> found = scan(Set.of());

        assertThat(find(found, "alpha").status()).isEqualTo(ExtensionStatus.INCOMPATIBLE);
        assertThat(find(found, "beta").status()).isEqualTo(ExtensionStatus.INCOMPATIBLE);
    }

    @Test
    void refusesAQuarkusExtensionAndAJarThatIsNotTheOneOfTheManifest() throws IOException {
        install(extensions, "alpha", new Library("quarkus-acme", "1.0", true));
        Path beta = install(extensions, "beta", new Library("parser", "1.2.0"));
        Files.writeString(beta.resolve("lib/parser-1.2.0.jar"), "changed");
        Path gamma = install(extensions, "gamma", new Library("parser", "1.2.0"));
        Files.delete(gamma.resolve("lib/parser-1.2.0.jar"));

        List<InstalledExtension> found = scan(Set.of());

        assertThat(find(found, "alpha").status()).isEqualTo(ExtensionStatus.INVALID);
        assertThat(find(found, "alpha").problems())
                .singleElement()
                .asString()
                .contains("org.example:quarkus-acme:1.0 is a Quarkus extension");
        assertThat(find(found, "beta").status()).isEqualTo(ExtensionStatus.INVALID);
        assertThat(find(found, "beta").problems()).singleElement().asString().contains("SHA-256");
        assertThat(find(found, "gamma").status()).isEqualTo(ExtensionStatus.INVALID);
        assertThat(find(found, "gamma").problems()).singleElement().asString().contains("is not in the package");
    }

    @Test
    void theMarketplaceNamesTheLibraryAndBothVersions() throws IOException {
        install(extensions, "alpha", new Library("parser", "1.2.0"));
        List<InstalledExtension> installed = scan(Set.of());
        Path candidates = Files.createDirectories(extensions.resolve(".candidates"));
        install(candidates, "beta", new Library("parser", "2.0.0"), new Library("shared", "2.0"));
        install(candidates, "alpha", new Library("parser", "1.3.0"));
        List<InstalledExtension> packages = new ExtensionCatalog(
                        KERNEL, BackendCheck.jarExists(), PackageTrust.none(), KernelLibraries.none(), Set.of())
                .scan(candidates);

        List<String> conflicts = new ArrayList<>(
                LibraryConflicts.of(find(packages, "beta").manifest().orElseThrow(), installed, KERNEL_LIBRARIES));

        assertThat(conflicts)
                .containsExactly(
                        "Library org.example:parser 2.0.0 conflicts with version 1.2.0 brought by extension"
                                + " dev.example.alpha: align the versions or relocate the library",
                        "Library org.example:shared 2.0 conflicts with the kernel, which provides version 1.0: use the"
                                + " version of the kernel or relocate the library");
        assertThat(LibraryConflicts.of(find(packages, "alpha").manifest().orElseThrow(), installed, KERNEL_LIBRARIES))
                .as("an update of the extension that brings the library")
                .isEmpty();
    }

    @Test
    void anOperationOnSeveralExtensionsChecksThemTogether() throws IOException {
        install(extensions, "alpha", new Library("parser", "1.2.0"));
        List<InstalledExtension> installed = scan(Set.of());
        Path candidates = Files.createDirectories(extensions.resolve(".candidates"));
        install(candidates, "alpha", new Library("parser", "2.0.0"));
        install(candidates, "beta", new Library("parser", "2.0.0"));
        install(candidates, "gamma", new Library("parser", "3.0.0"));
        List<InstalledExtension> packages = new ExtensionCatalog(
                        KERNEL, BackendCheck.jarExists(), PackageTrust.none(), KernelLibraries.none(), Set.of())
                .scan(candidates);
        var alpha = find(packages, "alpha").manifest().orElseThrow();
        var beta = find(packages, "beta").manifest().orElseThrow();
        var gamma = find(packages, "gamma").manifest().orElseThrow();

        assertThat(LibraryConflicts.of(List.of(alpha, beta), installed, KERNEL_LIBRARIES))
                .as("alpha is updated to the version of beta in the same operation")
                .isEmpty();
        assertThat(LibraryConflicts.of(List.of(beta), installed, KERNEL_LIBRARIES))
                .singleElement()
                .asString()
                .contains("2.0.0 conflicts with version 1.2.0 brought by extension dev.example.alpha");
        assertThat(LibraryConflicts.of(List.of(alpha, beta, gamma), installed, KERNEL_LIBRARIES))
                .containsExactly("Library org.example:parser 3.0.0 conflicts with version 2.0.0 brought by"
                        + " extension dev.example.alpha: align the versions or relocate the library");
    }

    @Test
    void theKernelReportsAnExtensionWhoseLibrariesItDidNotLoad() throws IOException {
        Path alpha = install(extensions, "alpha", new Library("parser", "1.2.0"), new Library("shared", "1.0"));
        String jar = ProviderState.sha256(alpha.resolve("lib/code.jar"));
        String parser = ProviderState.sha256(alpha.resolve("lib/parser-1.2.0.jar"));
        ProviderState withoutLibrary = new ProviderState(List.of(new ProviderState.Entry(jar, "dev.example.alpha")));
        ProviderState withLibrary = new ProviderState(List.of(
                new ProviderState.Entry(jar, "dev.example.alpha"),
                new ProviderState.Entry(parser, "library:org.example:parser:1.2.0")));
        ProviderState none = new ProviderState(List.of());

        assertThat(find(
                                new ExtensionCatalog(
                                                KERNEL,
                                                BackendCheck.loadedBy(withoutLibrary, none, KERNEL_LIBRARIES),
                                                PackageTrust.none(),
                                                KERNEL_LIBRARIES,
                                                Set.of())
                                        .scan(extensions),
                                "alpha")
                        .status())
                .isEqualTo(ExtensionStatus.RESTART_REQUIRED);
        assertThat(find(
                                new ExtensionCatalog(
                                                KERNEL,
                                                BackendCheck.loadedBy(withLibrary, none, KERNEL_LIBRARIES),
                                                PackageTrust.none(),
                                                KERNEL_LIBRARIES,
                                                Set.of())
                                        .scan(extensions),
                                "alpha")
                        .status())
                .as("the library the kernel provides needs no copy")
                .isEqualTo(ExtensionStatus.ACTIVE);
    }
}
