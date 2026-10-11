// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import dev.mosaikit.kernel.core.web.StaticFiles;
import java.io.IOException;
import java.nio.file.Path;
import java.util.Optional;

/**
 * Resolves files that a plugin serves to the browser, refusing anything outside the plugin
 * directory and any file type that is not a static web asset.
 */
public final class PluginAssets {

    private PluginAssets() {}

    /** A file to serve and its media type. */
    public record Asset(Path file, String mediaType) {}

    /**
     * Resolves {@code relativePath} inside {@code pluginDirectory}.
     *
     * @return the asset, or empty if the path escapes the plugin, is not a regular file, is the
     *     manifest, or has a media type that is not allowed
     */
    public static Optional<Asset> resolve(Path pluginDirectory, String relativePath) {
        return StaticFiles.resolve(pluginDirectory, relativePath)
                .filter(file -> !file.file().getFileName().toString().equals(PluginCatalog.MANIFEST_FILE)
                        || !file.file().getParent().equals(realPath(pluginDirectory)))
                .map(file -> new Asset(file.file(), file.mediaType()));
    }

    private static Path realPath(Path directory) {
        try {
            return directory.toRealPath();
        } catch (IOException _) {
            return directory;
        }
    }
}
