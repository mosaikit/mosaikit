// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

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
class ExtensionWatcherTest {

    @TempDir
    Path extensions;

    @Test
    void changesWithTheFilesOfTheExtensions() throws IOException {
        Path entry = Files.createDirectories(extensions.resolve("todo/web")).resolve("index.js");
        Files.writeString(entry, "export default {};");
        long before = ExtensionWatcher.fingerprint(extensions);
        assertThat(ExtensionWatcher.fingerprint(extensions)).isEqualTo(before);

        Files.writeString(entry, "export default { activate() {} };");
        assertThat(ExtensionWatcher.fingerprint(extensions)).isNotEqualTo(before);

        long edited = ExtensionWatcher.fingerprint(extensions);
        Files.setLastModifiedTime(entry, FileTime.from(Instant.parse("2030-01-01T00:00:00Z")));
        assertThat(ExtensionWatcher.fingerprint(extensions)).isNotEqualTo(edited);
    }

    @Test
    void ignoresWhatTheKernelAndTheBuildsWrite() throws IOException {
        Files.createDirectories(extensions.resolve("todo/web"));
        Files.writeString(extensions.resolve("todo/manifest.yaml"), "id: dev.example.todo");
        long before = ExtensionWatcher.fingerprint(extensions);

        for (String ignored : new String[] {".packages/x", ".previous/y", "todo/node_modules/z", "todo/target/w"}) {
            Path file = extensions.resolve(ignored);
            Files.createDirectories(file.getParent());
            Files.writeString(file, "ignored");
        }

        assertThat(ExtensionWatcher.fingerprint(extensions)).isEqualTo(before);
        assertThat(ExtensionWatcher.fingerprint(extensions.resolve("missing"))).isZero();
    }
}
