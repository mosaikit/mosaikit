// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

/**
 * Resolves static web files inside a directory, refusing anything outside it, symbolic links
 * that leave it, and any file type that is not a static web asset.
 */
public final class StaticFiles {

    private static final Map<String, String> MEDIA_TYPES = Map.ofEntries(
            Map.entry("js", "text/javascript"),
            Map.entry("mjs", "text/javascript"),
            Map.entry("css", "text/css"),
            Map.entry("json", "application/json"),
            Map.entry("map", "application/json"),
            Map.entry("svg", "image/svg+xml"),
            Map.entry("png", "image/png"),
            Map.entry("jpg", "image/jpeg"),
            Map.entry("jpeg", "image/jpeg"),
            Map.entry("webp", "image/webp"),
            Map.entry("ico", "image/x-icon"),
            Map.entry("woff", "font/woff"),
            Map.entry("woff2", "font/woff2"),
            Map.entry("html", "text/html"),
            Map.entry("webmanifest", "application/manifest+json"));

    private StaticFiles() {}

    /** A file to serve and its media type. */
    public record StaticFile(Path file, String mediaType) {}

    /**
     * Resolves {@code relativePath} inside {@code directory}.
     *
     * @return the file, or empty if the path escapes the directory, is not a regular file, or has
     *     a media type that is not allowed
     */
    public static Optional<StaticFile> resolve(Path directory, String relativePath) {
        if (relativePath == null || relativePath.isBlank() || relativePath.contains("\\")) {
            return Optional.empty();
        }
        try {
            Path root = directory.toRealPath();
            Path candidate = root.resolve(relativePath).normalize();
            if (!candidate.startsWith(root) || !Files.isRegularFile(candidate, LinkOption.NOFOLLOW_LINKS)) {
                return Optional.empty();
            }
            Path real = candidate.toRealPath();
            if (!real.startsWith(root)) {
                return Optional.empty();
            }
            return mediaType(real).map(type -> new StaticFile(real, type));
        } catch (IOException | InvalidPathException _) {
            return Optional.empty();
        }
    }

    /** Returns {@code true} when the last segment of the path has a file extension. */
    public static boolean looksLikeFile(String path) {
        String name = path.substring(path.lastIndexOf('/') + 1);
        return name.lastIndexOf('.') > 0;
    }

    private static Optional<String> mediaType(Path file) {
        String name = file.getFileName().toString();
        int dot = name.lastIndexOf('.');
        if (dot < 0) {
            return Optional.empty();
        }
        return Optional.ofNullable(MEDIA_TYPES.get(name.substring(dot + 1).toLowerCase(Locale.ROOT)));
    }
}
