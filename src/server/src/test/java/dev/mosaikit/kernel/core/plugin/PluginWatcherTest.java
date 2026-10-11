// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

@Tag("MK-046")
class PluginWatcherTest {

    @TempDir
    Path plugins;

    @Test
    void changesWithTheFilesOfThePlugins() throws IOException {
        Path entry = Files.createDirectories(plugins.resolve("todo/web")).resolve("index.js");
        Files.writeString(entry, "export default {};");
        long before = PluginWatcher.fingerprint(plugins);
        assertThat(PluginWatcher.fingerprint(plugins)).isEqualTo(before);

        Files.writeString(entry, "export default { activate() {} };");
        assertThat(PluginWatcher.fingerprint(plugins)).isNotEqualTo(before);

        long edited = PluginWatcher.fingerprint(plugins);
        Files.setLastModifiedTime(entry, FileTime.from(Instant.parse("2030-01-01T00:00:00Z")));
        assertThat(PluginWatcher.fingerprint(plugins)).isNotEqualTo(edited);
    }

    @Test
    void ignoresWhatTheKernelAndTheBuildsWrite() throws IOException {
        Files.createDirectories(plugins.resolve("todo/web"));
        Files.writeString(plugins.resolve("todo/manifest.yaml"), "id: dev.example.todo");
        long before = PluginWatcher.fingerprint(plugins);

        for (String ignored : new String[] {".packages/x", ".previous/y", "todo/node_modules/z", "todo/target/w"}) {
            Path file = plugins.resolve(ignored);
            Files.createDirectories(file.getParent());
            Files.writeString(file, "ignored");
        }

        assertThat(PluginWatcher.fingerprint(plugins)).isEqualTo(before);
        assertThat(PluginWatcher.fingerprint(plugins.resolve("missing"))).isZero();
    }
}
