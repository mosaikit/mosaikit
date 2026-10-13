// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.api.version.Version;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

@Tag("MK-011")
class ExtensionPackagesTest {

    private static final String MANIFEST = """
            id: dev.example.hello
            version: 1.0.0
            name: Hello
            kind: [app]
            platform: '>=0.1 <1'
            """;

    @TempDir
    Path extensions;

    @TempDir
    Path work;

    private Path zip(String name, Map<String, String> entries) throws IOException {
        Path zip = extensions.resolve(name);
        try (OutputStream file = Files.newOutputStream(zip);
                ZipOutputStream out = new ZipOutputStream(file)) {
            for (var entry : entries.entrySet()) {
                out.putNextEntry(new ZipEntry(entry.getKey()));
                out.write(entry.getValue().getBytes(UTF_8));
                out.closeEntry();
            }
        }
        return zip;
    }

    @Test
    void readsAExtensionFromItsPackageAsFromADirectory() throws IOException {
        zip("hello-1.0.0.zip", Map.of("manifest.yaml", MANIFEST, "web/index.js", "export default {};"));

        var found = new ExtensionCatalog(Version.parse("0.3.0")).scan(extensions, work);

        assertThat(found).singleElement().satisfies(extension -> {
            assertThat(extension.key()).isEqualTo("dev.example.hello");
            assertThat(extension.status()).isEqualTo(ExtensionStatus.ACTIVE);
            assertThat(extension.directory()).isEqualTo(work.resolve("hello-1.0.0"));
            assertThat(extension.directory().resolve("web/index.js")).hasContent("export default {};");
        });
    }

    @Test
    void unpacksAgainOnlyWhenThePackageChanges() throws IOException {
        Path zip = zip("hello.zip", Map.of("manifest.yaml", MANIFEST));
        Path unpacked = ExtensionPackages.unpack(zip, work);
        Files.writeString(unpacked.resolve("marker"), "kept while the package is the same");

        assertThat(ExtensionPackages.unpack(zip, work).resolve("marker")).exists();

        zip("hello.zip", Map.of("manifest.yaml", MANIFEST.replace("1.0.0", "1.1.0")));
        Path updated = ExtensionPackages.unpack(zip, work);
        assertThat(updated.resolve("marker")).doesNotExist();
        assertThat(updated.resolve("manifest.yaml")).content().contains("1.1.0");
    }

    @Test
    void refusesEntriesOutsideTheExtensionDirectory() throws IOException {
        var entries = new LinkedHashMap<String, String>();
        entries.put("manifest.yaml", MANIFEST);
        entries.put("../escaped.txt", "outside");
        Path zip = zip("evil.zip", entries);

        assertThatThrownBy(() -> ExtensionPackages.unpack(zip, work))
                .isInstanceOf(IOException.class)
                .hasMessageContaining("outside the extension directory");
        assertThat(work.resolve("escaped.txt")).doesNotExist();
        assertThat(work.getParent().resolve("escaped.txt")).doesNotExist();
    }

    @Test
    void reportsAnUnreadablePackageAsAnInvalidExtension() throws IOException {
        Files.writeString(extensions.resolve("broken.zip"), "not a zip");
        Files.createDirectories(extensions.resolve(".hidden"));

        var found = new ExtensionCatalog(Version.parse("0.3.0")).scan(extensions, work);

        assertThat(found).singleElement().satisfies(extension -> {
            assertThat(extension.key()).isEqualTo("broken.zip");
            assertThat(extension.status()).isEqualTo(ExtensionStatus.INVALID);
            assertThat(extension.problems().getFirst()).startsWith("Unreadable package");
        });
    }
}
