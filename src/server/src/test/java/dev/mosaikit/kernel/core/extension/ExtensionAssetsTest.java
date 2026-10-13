// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

@Tag("MK-007")
class ExtensionAssetsTest {

    @TempDir
    Path root;

    private Path extension;

    @BeforeEach
    void createExtension() throws IOException {
        extension = Files.createDirectories(root.resolve("extension"));
        Files.createDirectories(extension.resolve("web"));
        Files.writeString(extension.resolve("web/index.js"), "export {}");
        Files.writeString(extension.resolve("web/notes.txt"), "not a web asset");
        Files.writeString(extension.resolve(ExtensionCatalog.MANIFEST_FILE), "id: x");
        Files.writeString(root.resolve("secret.js"), "outside");
    }

    @Test
    void servesStaticAssetsWithTheirMediaType() {
        assertThat(ExtensionAssets.resolve(extension, "web/index.js"))
                .hasValueSatisfying(asset -> assertThat(asset.mediaType()).isEqualTo("text/javascript"));
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "../secret.js",
                "web/../../secret.js",
                "web\\index.js",
                "manifest.yaml",
                "web/notes.txt",
                "web",
                "missing.js",
                " "
            })
    void refusesEverythingElse(String path) {
        assertThat(ExtensionAssets.resolve(extension, path)).isEmpty();
    }

    @Test
    void refusesAbsolutePaths() {
        assertThat(ExtensionAssets.resolve(extension, root.resolve("secret.js").toString()))
                .isEmpty();
    }
}
