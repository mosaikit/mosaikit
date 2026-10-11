// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.marketplace;

import jakarta.enterprise.context.ApplicationScoped;
import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Locale;

/**
 * Reads the files of a catalog directory: {@code file:} for a local or removable directory (offline
 * transfer), {@code https:} (or {@code http:} for a local test server) for a published one.
 */
@ApplicationScoped
public class CatalogSources {

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build();

    /**
     * Reads one file of a catalog directory.
     *
     * @param maxBytes largest size accepted
     * @throws IOException when the file cannot be read, is missing or is too large
     */
    public byte[] read(URI directory, String file, long maxBytes) throws IOException {
        URI uri = resolve(directory, file);
        String scheme = String.valueOf(uri.getScheme()).toLowerCase(Locale.ROOT);
        return switch (scheme) {
            case "file" -> readFile(Path.of(uri), maxBytes);
            case "http", "https" -> download(uri, maxBytes);
            default -> throw new IOException("Unsupported catalog scheme: " + uri.getScheme());
        };
    }

    /** The URI of a file in a catalog directory, refusing names that leave it. */
    static URI resolve(URI directory, String file) throws IOException {
        if (file.isBlank() || file.contains("/") || file.contains("\\") || file.startsWith(".")) {
            throw new IOException("Not a file name of the catalog: " + file);
        }
        String base = directory.toString();
        return URI.create(base.endsWith("/") ? base : base + "/").resolve(file);
    }

    private static byte[] readFile(Path file, long maxBytes) throws IOException {
        if (Files.size(file) > maxBytes) {
            throw new IOException(file + " is larger than " + maxBytes + " bytes");
        }
        return Files.readAllBytes(file);
    }

    private byte[] download(URI uri, long maxBytes) throws IOException {
        HttpRequest request =
                HttpRequest.newBuilder(uri).timeout(Duration.ofMinutes(5)).GET().build();
        try {
            HttpResponse<InputStream> response = http.send(request, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream body = response.body()) {
                if (response.statusCode() != 200) {
                    throw new IOException(uri + " answered " + response.statusCode());
                }
                byte[] bytes = body.readNBytes((int) Math.min(Integer.MAX_VALUE - 8L, maxBytes + 1));
                if (bytes.length > maxBytes) {
                    throw new IOException(uri + " is larger than " + maxBytes + " bytes");
                }
                return bytes;
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IOException("Interrupted while reading " + uri, e);
        }
    }
}
