// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.signature;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.PrintStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

@Tag("MK-022")
class ExtensionIndexTest {

    private static final KeyPair CATALOG = SigningKeys.generate();
    private static final KeyPair PUBLISHER = SigningKeys.generate();
    private static final Instant NOW = Instant.parse("2026-09-30T12:00:00Z");

    @TempDir
    Path directory;

    private Path pkg(String name, String manifest) throws IOException {
        Path file = directory.resolve(name);
        try (var out = new ZipOutputStream(Files.newOutputStream(file))) {
            out.putNextEntry(new ZipEntry("manifest.yaml"));
            out.write(manifest.getBytes(UTF_8));
            out.closeEntry();
        }
        return file;
    }

    @Test
    void writesASignedIndexOfThePackagesOfADirectory() throws Exception {
        Path notes = pkg(
                "notes.zip",
                "# comment\nid: dev.acme.notes\nversion: '1.2.0'\nname: \"Notes of Acme\"\nfrontend:\n  id: nested\n");
        PackageSignatures.sign(notes, PUBLISHER);
        pkg("maps.zip", "id: dev.acme.maps\nversion: 2.0.0\n");
        Files.writeString(directory.resolve("README.md"), "not a package");

        List<ExtensionIndex.Entry> entries = ExtensionIndex.write(directory, CATALOG, NOW);

        assertThat(entries).extracting(ExtensionIndex.Entry::id).containsExactly("dev.acme.maps", "dev.acme.notes");
        assertThat(entries.get(0).name()).isEqualTo("dev.acme.maps");
        assertThat(entries.get(0).publisherKey()).isEmpty();
        assertThat(entries.get(1))
                .extracting(
                        ExtensionIndex.Entry::version, ExtensionIndex.Entry::publisherKey, ExtensionIndex.Entry::size)
                .containsExactly("1.2.0", SigningKeys.keyId(PUBLISHER.getPublic()), Files.size(notes));
        byte[] index = Files.readAllBytes(directory.resolve(ExtensionIndex.INDEX_FILE));
        byte[] signature = Files.readAllBytes(directory.resolve(ExtensionIndex.SIGNATURE_FILE));
        assertThat(new String(index, UTF_8))
                .contains("\"format\": 1", "\"generated\": \"2026-09-30T12:00:00Z\"", "\"file\": \"notes.zip\"")
                .contains("\"name\": \"Notes of Acme\"")
                .doesNotContain("nested");

        String keyId = SigningKeys.keyId(CATALOG.getPublic());
        assertThat(ExtensionIndex.verify(index, signature, Map.of(keyId, CATALOG.getPublic())))
                .isEqualTo(keyId);
    }

    @Test
    void refusesAnIndexThatIsChangedOrSignedByAnotherKey() throws Exception {
        pkg("maps.zip", "id: dev.acme.maps\nversion: 2.0.0\n");
        ExtensionIndex.write(directory, CATALOG, NOW);
        byte[] index = Files.readAllBytes(directory.resolve(ExtensionIndex.INDEX_FILE));
        byte[] signature = Files.readAllBytes(directory.resolve(ExtensionIndex.SIGNATURE_FILE));
        String keyId = SigningKeys.keyId(CATALOG.getPublic());
        var trusted = Map.of(keyId, CATALOG.getPublic());

        byte[] changed = new String(index, UTF_8).replace("2.0.0", "2.0.1").getBytes(UTF_8);
        assertThatThrownBy(() -> ExtensionIndex.verify(changed, signature, trusted))
                .isInstanceOf(PackageSignatureException.class)
                .hasMessageContaining("does not match");
        assertThatThrownBy(() -> ExtensionIndex.verify(index, signature, Map.of()))
                .hasMessageContaining("not trusted");
        byte[] otherAlgorithm =
                new String(signature, UTF_8).replace("Ed25519", "RSA").getBytes(UTF_8);
        assertThatThrownBy(() -> ExtensionIndex.verify(index, otherAlgorithm, trusted))
                .hasMessageContaining("Unsupported");
        byte[] malformed = "algorithm=\\uZZZZ\n".getBytes(UTF_8);
        assertThatThrownBy(() -> ExtensionIndex.verify(index, malformed, trusted))
                .isInstanceOf(PackageSignatureException.class)
                .hasMessageContaining("Unreadable");
    }

    @Test
    void refusesPackagesWithoutIdentity() throws IOException {
        Path broken = pkg("broken.zip", "name: nothing\n");

        assertThatThrownBy(() -> ExtensionIndex.describe(broken)).hasMessageContaining("no manifest.yaml");
        assertThat(ExtensionIndex.quote("a\u0001\tb\r\n\\")).isEqualTo("\"a\\u0001\\tb\\r\\n\\\\\"");
        assertThat(ExtensionIndex.toJson(List.of(), NOW)).contains("\"extensions\": []");
    }

    @Test
    void writesTheIndexFromTheCommandLine() throws IOException {
        pkg("maps.zip", "id: dev.acme.maps\nversion: 2.0.0\n");
        Path keys = directory.resolve("keys");
        SigningKeys.write(CATALOG, keys, "catalog");
        var out = new ByteArrayOutputStream();

        int code = PackageSigningTool.run(
                new String[] {"index", keys.resolve("catalog").toString(), directory.toString()},
                new PrintStream(out, true, UTF_8),
                new PrintStream(new ByteArrayOutputStream(), true, UTF_8));

        assertThat(code).isZero();
        assertThat(out.toString(UTF_8)).contains("Index of 1 packages");
        assertThat(directory.resolve(ExtensionIndex.SIGNATURE_FILE)).exists();
    }
}
