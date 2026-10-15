// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.launcher;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.api.version.Version;
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

/** The launcher copies the libraries of Java extensions into the providers directory (MK-131). */
@Tag("MK-131")
class LauncherLibrariesTest {

    private static final Version KERNEL = Version.parse("0.1.0");
    private static final KernelLibraries KERNEL_LIBRARIES =
            KernelLibraries.of(List.of(new KernelLibraries.Library("org.example", "shared", "", "1.0")));
    private static final String PARSER_1 = "org.example_parser_1.2.0.jar";
    private static final String PARSER_2 = "org.example_parser_1.3.0.jar";

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
                KERNEL_LIBRARIES);
        assertThat(launcher.prepare(installation, KERNEL, true)).isZero();
        // What the kernel does once it has started.
        Files.deleteIfExists(installation.providers().resolve(ProviderState.PENDING_FILE));
    }

    /** A Java extension with libraries {@code artifactId:version}, listed in its manifest. */
    private void install(String name, String... libraries) throws IOException {
        Path root = installation.extensions().resolve(name);
        Files.createDirectories(root.resolve("lib"));
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
                libraries:
                """.formatted(name, name));
        for (String library : libraries) {
            String[] parts = library.split(":");
            String file = "lib/" + parts[0] + "-" + parts[1] + ".jar";
            Path jar = root.resolve(file);
            try (OutputStream out = Files.newOutputStream(jar);
                    ZipOutputStream zip = new ZipOutputStream(out)) {
                zip.putNextEntry(new ZipEntry("org/example/" + parts[0] + ".class"));
                zip.write(parts[1].getBytes(UTF_8));
                zip.closeEntry();
            }
            manifest.append("  - jar: \"%s\"\n    coordinates: \"org.example:%s\"\n    sha256: \"%s\"\n"
                    .formatted(file, library, ProviderState.sha256(jar)));
        }
        Files.writeString(root.resolve("manifest.yaml"), manifest.toString());
    }

    private List<String> providers() throws IOException {
        try (Stream<Path> files = Files.list(installation.providers())) {
            return files.map(file -> file.getFileName().toString())
                    .filter(name -> name.endsWith(".jar"))
                    .sorted()
                    .toList();
        }
    }

    @Test
    void copiesALibraryOnceAndKeepsItWhileAnExtensionBringsIt() throws IOException {
        install("alpha", "parser:1.2.0", "shared:1.0");
        install("beta", "parser:1.2.0");

        prepare();

        assertThat(rebuilds).hasValue(1);
        assertThat(providers())
                .as("one copy of the library; none of the library the kernel provides")
                .containsExactly("dev.example.alpha.jar", "dev.example.beta.jar", PARSER_1);
        assertThat(ProviderState.read(installation.providers()).entries())
                .extracting(ProviderState.Entry::extensionId)
                .containsExactlyInAnyOrder("dev.example.alpha", "dev.example.beta", "library:org.example:parser:1.2.0");
        assertThat(output.toString(UTF_8)).contains("added library:org.example:parser:1.2.0");

        prepare();
        assertThat(rebuilds).as("nothing changed").hasValue(1);
        assertThat(output.toString(UTF_8)).contains("2 Java extension(s) with 1 library, kernel up to date");

        deleteRecursively(installation.extensions().resolve("alpha"));
        prepare();
        assertThat(providers()).as("beta still brings it").containsExactly("dev.example.beta.jar", PARSER_1);

        deleteRecursively(installation.extensions().resolve("beta"));
        prepare();
        assertThat(rebuilds).hasValue(3);
        assertThat(providers()).isEmpty();
    }

    @Test
    void rebuildsWhenOnlyALibraryChanges() throws IOException {
        install("alpha", "parser:1.2.0");
        prepare();

        install("alpha", "parser:1.3.0");
        prepare();

        assertThat(rebuilds).hasValue(2);
        assertThat(output.toString(UTF_8))
                .contains("added library:org.example:parser:1.3.0")
                .contains("removed library:org.example:parser:1.2.0");
        assertThat(providers()).containsExactly("dev.example.alpha.jar", PARSER_2);
    }

    @Test
    void leavesOutAnExtensionWhoseLibraryConflictsAndSaysWhy() throws IOException {
        install("alpha", "parser:1.2.0");
        prepare();
        install("beta", "parser:1.3.0", "shared:2.0");

        prepare();

        assertThat(rebuilds).as("beta is not loaded").hasValue(1);
        assertThat(output.toString(UTF_8))
                .contains("dev.example.beta is INCOMPATIBLE")
                .contains("org.example:shared 2.0 conflicts with the kernel, which provides version 1.0");
        assertThat(providers()).containsExactly("dev.example.alpha.jar", PARSER_1);
    }

    private static void deleteRecursively(Path directory) throws IOException {
        try (Stream<Path> paths = Files.walk(directory)) {
            for (Path path : paths.sorted(java.util.Comparator.reverseOrder()).toList()) {
                Files.delete(path);
            }
        }
    }
}
