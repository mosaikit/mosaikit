// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.files;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.api.resource.ResourceRef;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The values of the file service of the kernel (MK-041). */
@Tag("MK-041")
class FileStorageTypesTest {

    private static StoredFile file(long size, UUID team) {
        Instant now = Instant.now();
        return new StoredFile(
                UUID.randomUUID(), "org.example.maps", "a.png", "image/png", size, "ab", null, team, null, now, now);
    }

    @Test
    void describesANewFile() {
        UUID team = UUID.randomUUID();
        ResourceRef album = new ResourceRef("org.example.maps", "album", "summer");

        FileStorage.NewFile file =
                FileStorage.NewFile.of("a.png", "image/png").forTeam(team).attachedTo(album);

        assertThat(file).isEqualTo(new FileStorage.NewFile("a.png", "image/png", team, album));
        assertThat(FileStorage.NewFile.of("a.png", null).team()).isNull();
    }

    @Test
    void aStoredFileHasItsFields() {
        assertThat(file(3, null).ofTeam()).isFalse();
        assertThat(file(3, UUID.randomUUID()).ofTeam()).isTrue();
        assertThatThrownBy(() -> file(-1, null)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void closingTheContentClosesItsStream() throws Exception {
        AtomicBoolean closed = new AtomicBoolean();
        InputStream stream = new ByteArrayInputStream(new byte[] {1, 2, 3}) {
            @Override
            public void close() {
                closed.set(true);
            }
        };
        StoredFile file = file(3, null);
        try (FileContent content = new FileContent(file, stream)) {
            assertThat(content.file()).isEqualTo(file);
            assertThat(content.stream().readAllBytes()).containsExactly(1, 2, 3);
        }
        assertThat(closed).isTrue();
    }
}
