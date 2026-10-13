// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.files;

import java.io.IOException;
import java.io.InputStream;
import java.util.Objects;

/**
 * The content of a file, streamed from the store, with what the kernel knows of the file (MK-041).
 * Close it when done, as with any stream, preferably with try-with-resources:
 *
 * <pre>{@code
 * try (FileContent content = files.read(EXTENSION, id)) {
 *     content.stream().transferTo(output);
 * }
 * }</pre>
 */
public final class FileContent implements AutoCloseable {

    private final StoredFile file;
    private final InputStream stream;

    /**
     * Pairs a file with its content; the kernel makes these.
     *
     * @param stream the content, which this object closes
     */
    public FileContent(StoredFile file, InputStream stream) {
        this.file = Objects.requireNonNull(file, "file");
        this.stream = Objects.requireNonNull(stream, "stream");
    }

    /** What the kernel knows of the file. */
    public StoredFile file() {
        return file;
    }

    /** The content, {@link StoredFile#size()} bytes long. */
    public InputStream stream() {
        return stream;
    }

    @Override
    public void close() throws IOException {
        stream.close();
    }
}
