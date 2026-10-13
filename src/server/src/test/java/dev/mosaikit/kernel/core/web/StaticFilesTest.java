// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

@Tag("MK-008")
class StaticFilesTest {

    @TempDir
    Path root;

    @Test
    void resolvesAnAssetWithItsMediaType() throws IOException {
        Files.createDirectories(root.resolve("assets"));
        Files.writeString(root.resolve("assets/index.js.map"), "{}");

        assertThat(StaticFiles.resolve(root, "assets/index.js.map"))
                .hasValueSatisfying(file -> assertThat(file.mediaType()).isEqualTo("application/json"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"../outside.js", "assets/../../outside.js", "assets\\index.js", "", "secret.yaml"})
    void refusesPathsOutsideTheDirectoryAndUnknownTypes(String path) throws IOException {
        Files.writeString(root.resolve("secret.yaml"), "password: x");

        assertThat(StaticFiles.resolve(root, path)).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"/assets/index.js", "/favicon.ico", "/a/b.c"})
    void recognizesPathsOfFiles(String path) {
        assertThat(StaticFiles.looksLikeFile(path)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"/", "/app/notes", "/app/.hidden/"})
    void recognizesApplicationRoutes(String path) {
        assertThat(StaticFiles.looksLikeFile(path)).isFalse();
    }
}
