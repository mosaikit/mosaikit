// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The store of files in a directory (MK-041). */
@Tag("MK-041")
class FilesystemFileStoreTest {

    @TempDir
    Path directory;

    @TempDir
    Path uploads;

    private Path upload(String content) throws Exception {
        return Files.writeString(Files.createTempFile(uploads, "upload", ".bin"), content);
    }

    private static String read(InputStream in) throws Exception {
        try (in) {
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    void storesReadsByRangeAndDeletes() throws Exception {
        FileStore store = new FilesystemFileStore(directory);
        String key = FileStore.key(UUID.randomUUID(), "dev.mosaikit.test.files", UUID.randomUUID());
        Path content = upload("0123456789");

        store.put(key, content, 10, "text/plain");

        assertThat(directory.resolve(key)).hasContent("0123456789");
        assertThat(read(store.read(key, 0, 10))).isEqualTo("0123456789");
        assertThat(read(store.read(key, 3, 4))).isEqualTo("3456");
        assertThat(read(store.read(key, 9, 1))).isEqualTo("9");
        try (InputStream in = store.read(key, 2, 3)) {
            assertThat(in.read()).isEqualTo('2');
            assertThat(in.skip(1)).isEqualTo(1);
            assertThat(in.read()).isEqualTo('4');
            assertThat(in.read()).isEqualTo(-1);
        }

        store.put(key, upload("replaced"), 8, "text/plain");
        assertThat(read(store.read(key, 0, 8))).isEqualTo("replaced");
        assertThat(store.describe()).contains(directory.toString());

        store.delete(key);
        store.delete(key);
        assertThat(Files.exists(directory.resolve(key))).isFalse();
        assertThatThrownBy(() -> store.read(key, 0, 1)).isInstanceOf(NoSuchFileException.class);
    }

    @Test
    void refusesAKeyOutsideItsDirectory() {
        FilesystemFileStore store = new FilesystemFileStore(directory);
        assertThatThrownBy(() -> store.resolve("../outside")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> store.resolve("a/../../outside")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> store.resolve(".")).isInstanceOf(IllegalArgumentException.class);
        assertThat(store.resolve("a/b/c").startsWith(directory.toAbsolutePath().normalize()))
                .isTrue();
    }
}
