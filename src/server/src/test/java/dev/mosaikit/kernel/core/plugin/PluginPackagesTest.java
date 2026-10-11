// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

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
class PluginPackagesTest {

    private static final String MANIFEST = """
            id: dev.example.hello
            version: 1.0.0
            name: Hello
            kind: [app]
            platform: '>=0.1 <1'
            """;

    @TempDir
    Path plugins;

    @TempDir
    Path work;

    private Path zip(String name, Map<String, String> entries) throws IOException {
        Path zip = plugins.resolve(name);
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
    void readsAPluginFromItsPackageAsFromADirectory() throws IOException {
        zip("hello-1.0.0.zip", Map.of("manifest.yaml", MANIFEST, "web/index.js", "export default {};"));

        var found = new PluginCatalog(Version.parse("0.3.0")).scan(plugins, work);

        assertThat(found).singleElement().satisfies(plugin -> {
            assertThat(plugin.key()).isEqualTo("dev.example.hello");
            assertThat(plugin.status()).isEqualTo(PluginStatus.ACTIVE);
            assertThat(plugin.directory()).isEqualTo(work.resolve("hello-1.0.0"));
            assertThat(plugin.directory().resolve("web/index.js")).hasContent("export default {};");
        });
    }

    @Test
    void unpacksAgainOnlyWhenThePackageChanges() throws IOException {
        Path zip = zip("hello.zip", Map.of("manifest.yaml", MANIFEST));
        Path unpacked = PluginPackages.unpack(zip, work);
        Files.writeString(unpacked.resolve("marker"), "kept while the package is the same");

        assertThat(PluginPackages.unpack(zip, work).resolve("marker")).exists();

        zip("hello.zip", Map.of("manifest.yaml", MANIFEST.replace("1.0.0", "1.1.0")));
        Path updated = PluginPackages.unpack(zip, work);
        assertThat(updated.resolve("marker")).doesNotExist();
        assertThat(updated.resolve("manifest.yaml")).content().contains("1.1.0");
    }

    @Test
    void refusesEntriesOutsideThePluginDirectory() throws IOException {
        var entries = new LinkedHashMap<String, String>();
        entries.put("manifest.yaml", MANIFEST);
        entries.put("../escaped.txt", "outside");
        Path zip = zip("evil.zip", entries);

        assertThatThrownBy(() -> PluginPackages.unpack(zip, work))
                .isInstanceOf(IOException.class)
                .hasMessageContaining("outside the plugin directory");
        assertThat(work.resolve("escaped.txt")).doesNotExist();
        assertThat(work.getParent().resolve("escaped.txt")).doesNotExist();
    }

    @Test
    void reportsAnUnreadablePackageAsAnInvalidPlugin() throws IOException {
        Files.writeString(plugins.resolve("broken.zip"), "not a zip");
        Files.createDirectories(plugins.resolve(".hidden"));

        var found = new PluginCatalog(Version.parse("0.3.0")).scan(plugins, work);

        assertThat(found).singleElement().satisfies(plugin -> {
            assertThat(plugin.key()).isEqualTo("broken.zip");
            assertThat(plugin.status()).isEqualTo(PluginStatus.INVALID);
            assertThat(plugin.problems().getFirst()).startsWith("Unreadable package");
        });
    }
}
