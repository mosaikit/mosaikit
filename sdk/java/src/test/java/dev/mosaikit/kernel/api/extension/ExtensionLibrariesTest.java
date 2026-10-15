// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The libraries of a Java extension in its manifest, and the tool of the build that writes them (MK-131). */
@Tag("MK-131")
class ExtensionLibrariesTest {

    private static final String SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    @TempDir
    Path extension;

    private static Map<String, Object> tree(List<Object> libraries) {
        Map<String, Object> tree = new HashMap<>();
        tree.put("id", "dev.example.catalog");
        tree.put("version", "1.0.0");
        tree.put("name", "Catalog");
        tree.put("kind", "app");
        tree.put("platform", ">=0.1");
        tree.put("backend", Map.of("jar", "lib/catalog.jar", "api", "catalog"));
        tree.put("libraries", libraries);
        return tree;
    }

    private static List<ManifestViolation> violations(Map<String, Object> tree) {
        return ((ManifestParseResult.Invalid) ExtensionManifests.parse(tree)).violations();
    }

    @Test
    void readsTheLibrariesWithTheirCoordinatesAndDigests() {
        var result = ExtensionManifests.parse(tree(List.of(
                Map.of("jar", "lib/parser-1.2.0.jar", "coordinates", "org.example:parser:1.2.0", "sha256", SHA),
                Map.of(
                        "jar",
                        "lib/native-1.0-linux.jar",
                        "coordinates",
                        "org.example:native:1.0:linux",
                        "sha256",
                        SHA))));

        ExtensionManifest manifest = ((ManifestParseResult.Valid) result).manifest();
        assertThat(manifest.libraries())
                .containsExactly(
                        new LibraryEntry("lib/parser-1.2.0.jar", "org.example", "parser", "1.2.0", "", SHA),
                        new LibraryEntry("lib/native-1.0-linux.jar", "org.example", "native", "1.0", "linux", SHA));
        assertThat(manifest.libraries().get(0).key()).isEqualTo("org.example:parser");
        assertThat(manifest.libraries().get(1).key()).isEqualTo("org.example:native:linux");
        assertThat(manifest.libraries().get(1).coordinates()).isEqualTo("org.example:native:1.0:linux");
    }

    @Test
    void anExtensionWithoutLibrariesHasNone() {
        Map<String, Object> tree = tree(List.of());
        tree.remove("libraries");
        assertThat(((ManifestParseResult.Valid) ExtensionManifests.parse(tree))
                        .manifest()
                        .libraries())
                .isEmpty();
    }

    @Test
    void refusesLibrariesThatCannotBeChecked() {
        Map<String, Object> tree = tree(List.of(
                Map.of("jar", "../parser.jar", "coordinates", "org.example:parser:1.2.0", "sha256", SHA),
                Map.of("jar", "lib/a.jar", "coordinates", "parser-1.2.0", "sha256", SHA.toUpperCase()),
                Map.of("jar", "lib/catalog.jar", "coordinates", "org.example:other:1", "sha256", SHA),
                Map.of("jar", "lib/b.jar", "coordinates", "org.example:twice:1", "sha256", SHA),
                Map.of("jar", "lib/c.jar", "coordinates", "org.example:twice:2", "sha256", SHA),
                "lib/d.jar"));

        assertThat(violations(tree))
                .extracting(ManifestViolation::field)
                .containsExactly(
                        "libraries[0].jar",
                        "libraries[1].sha256",
                        "libraries[1].coordinates",
                        "libraries[2].jar",
                        "libraries[4].coordinates",
                        "libraries[5]");
    }

    @Test
    void librariesNeedTheJavaCodeOfTheExtension() {
        Map<String, Object> tree = tree(List.of(
                Map.of("jar", "lib/parser-1.2.0.jar", "coordinates", "org.example:parser:1.2.0", "sha256", SHA)));
        tree.remove("backend");
        assertThat(violations(tree)).extracting(ManifestViolation::field).containsExactly("libraries");
    }

    @Test
    void theToolListsTheRuntimeDependenciesInTheManifestAndKeepsTheRest() throws IOException {
        Path lib = Files.createDirectories(extension.resolve("lib"));
        jar(lib.resolve("parser-1.2.0.jar"), "Parser.class");
        jar(lib.resolve("native-1.0-linux.jar"), "Native.class");
        Path list = extension.resolve("dependencies.txt");
        Files.writeString(list, """
                The following files have been resolved:
                   org.example:parser:jar:1.2.0:compile\u001B[36m -- module org.example.parser\u001B[m
                   org.example:native:jar:linux:1.0:runtime -- module native [auto]
                   org.example:bom:pom:1.0:compile
                """);
        Path manifest = extension.resolve("manifest.yaml");
        Files.writeString(manifest, """
                id: dev.example.catalog # the id
                version: 1.0.0
                name: Catalog
                kind: app
                platform: '>=0.1'
                backend:
                  jar: lib/catalog.jar
                  api: catalog
                """);

        assertThat(run(list, lib, manifest)).isZero();

        String written = Files.readString(manifest);
        assertThat(written)
                .startsWith("id: dev.example.catalog # the id\nversion: 1.0.0\n")
                .contains("""
                          api: catalog
                        libraries:
                          # Written by the build of the extension from its runtime dependencies (MK-131): do not edit.
                          - jar: 'lib/parser-1.2.0.jar'
                            coordinates: 'org.example:parser:1.2.0'
                            sha256: '%s'
                          - jar: 'lib/native-1.0-linux.jar'
                            coordinates: 'org.example:native:1.0:linux'
                        """.formatted(sha256(lib.resolve("parser-1.2.0.jar"))));

        // Again, unchanged: the file is not written.
        assertThat(run(list, lib, manifest)).isZero();
        assertThat(Files.readString(manifest)).isEqualTo(written);

        // A library the extension no longer uses leaves the manifest and the lib directory.
        Files.writeString(list, "   org.example:parser:jar:1.2.0:compile\n");
        assertThat(run(list, lib, manifest)).isZero();
        assertThat(Files.readString(manifest))
                .contains("org.example:parser:1.2.0")
                .doesNotContain("native");
        assertThat(lib.resolve("native-1.0-linux.jar")).doesNotExist();
        assertThat(lib.resolve("parser-1.2.0.jar")).exists();

        // Without libraries, the block goes away and the manifest is as written by hand.
        Files.writeString(list, "The following files have been resolved:\n   none\n");
        assertThat(run(list, lib, manifest)).isZero();
        assertThat(Files.readString(manifest)).doesNotContain("libraries").endsWith("  api: catalog\n");
    }

    @Test
    void theToolRefusesAQuarkusExtension() throws IOException {
        Path lib = Files.createDirectories(extension.resolve("lib"));
        try (OutputStream file = Files.newOutputStream(lib.resolve("quarkus-acme-1.0.jar"));
                ZipOutputStream zip = new ZipOutputStream(file)) {
            zip.putNextEntry(new ZipEntry(ExtensionLibrariesTool.QUARKUS_EXTENSION_FILE));
            zip.write("deployment-artifact=io.quarkus:quarkus-acme-deployment:1.0\n".getBytes(UTF_8));
            zip.closeEntry();
        }
        Path list =
                Files.writeString(extension.resolve("dependencies.txt"), "io.quarkus:quarkus-acme:jar:1.0:compile\n");
        Path manifest = Files.writeString(extension.resolve("manifest.yaml"), "id: dev.example.catalog\n");
        ByteArrayOutputStream err = new ByteArrayOutputStream();

        int code = ExtensionLibrariesTool.run(
                new String[] {list.toString(), lib.toString(), manifest.toString()},
                new PrintStream(OutputStream.nullOutputStream()),
                new PrintStream(err, true, UTF_8));

        assertThat(code).isEqualTo(1);
        assertThat(err.toString(UTF_8)).contains("io.quarkus:quarkus-acme:1.0 is a Quarkus extension");
        assertThat(Files.readString(manifest)).isEqualTo("id: dev.example.catalog\n");
    }

    /** A JAR with one entry. */
    private static void jar(Path file, String entry) throws IOException {
        try (OutputStream out = Files.newOutputStream(file);
                ZipOutputStream zip = new ZipOutputStream(out)) {
            zip.putNextEntry(new ZipEntry(entry));
            zip.write(entry.getBytes(UTF_8));
            zip.closeEntry();
        }
    }

    private static String sha256(Path file) throws IOException {
        try {
            return java.util.HexFormat.of()
                    .formatHex(
                            java.security.MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(file)));
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static int run(Path list, Path lib, Path manifest) {
        return ExtensionLibrariesTool.run(
                new String[] {list.toString(), lib.toString(), manifest.toString()},
                new PrintStream(OutputStream.nullOutputStream()),
                new PrintStream(OutputStream.nullOutputStream()));
    }
}
