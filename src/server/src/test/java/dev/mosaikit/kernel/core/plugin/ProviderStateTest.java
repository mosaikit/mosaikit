// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

@Tag("MK-011")
class ProviderStateTest {

    @TempDir
    Path providers;

    @Test
    void isEmptyBeforeTheFirstRebuild() {
        assertThat(ProviderState.read(providers).entries()).isEmpty();
    }

    @Test
    void survivesAWriteAndReadRoundTrip() {
        var state = new ProviderState(List.of(
                new ProviderState.Entry("a".repeat(64), "dev.example.notes"),
                new ProviderState.Entry("b".repeat(64), "dev.example.board")));

        state.write(providers);

        assertThat(ProviderState.read(providers)).isEqualTo(state);
        assertThat(ProviderState.read(providers).contains("dev.example.notes", "a".repeat(64)))
                .isTrue();
        assertThat(ProviderState.read(providers).contains("dev.example.notes", "b".repeat(64)))
                .isFalse();
    }

    @Test
    void ignoresCommentsBlankLinesAndMalformedLines() throws IOException {
        Files.writeString(
                providers.resolve(ProviderState.FILE_NAME),
                "# comment\n\nnot-a-valid-line\n" + "c".repeat(64) + " dev.x.y\n");

        assertThat(ProviderState.read(providers).entries())
                .containsExactly(new ProviderState.Entry("c".repeat(64), "dev.x.y"));
    }

    @Test
    void canBeCleared() {
        new ProviderState(List.of(new ProviderState.Entry("d".repeat(64), "dev.x.y"))).write(providers);

        ProviderState.clear(providers);

        assertThat(ProviderState.read(providers).entries()).isEmpty();
    }

    @Test
    void hashesFilesWithSha256() throws IOException {
        Path file = Files.writeString(providers.resolve("empty.jar"), "");

        assertThat(ProviderState.sha256(file))
                .isEqualTo("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    }
}
