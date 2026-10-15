// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.resource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** What a version of a resource holds (MK-096). */
@Tag("MK-096")
class VersionsTest {

    @Test
    void aVersionHoldsEitherASnapshotOrAFile() {
        Versions.Content json = Versions.Content.json("{\"a\":1}");
        assertThat(json.isFile()).isFalse();
        assertThat(json.mediaType()).isEqualTo("application/json");
        assertThat(json.text()).isEqualTo("{\"a\":1}");

        UUID id = UUID.randomUUID();
        Versions.Content file = Versions.Content.file(id);
        assertThat(file.isFile()).isTrue();
        assertThat(file.file()).isEqualTo(id);
        assertThatThrownBy(file::text).isInstanceOf(IllegalStateException.class);

        assertThat(Versions.Content.snapshot(" ", new byte[] {1}).mediaType()).isEqualTo(Versions.OCTET_STREAM);
        assertThatThrownBy(() -> new Versions.Content("text/plain", new byte[0], id))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Versions.Content("text/plain", null, null))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void aSnapshotHasAtMostTheLargestSize() {
        assertThat(Versions.Content.snapshot("application/octet-stream", new byte[Versions.MAX_SNAPSHOT])
                        .snapshot())
                .hasSize(Versions.MAX_SNAPSHOT);
        assertThatThrownBy(() ->
                        Versions.Content.snapshot("application/octet-stream", new byte[Versions.MAX_SNAPSHOT + 1]))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
