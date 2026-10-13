// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Path;
import java.util.UUID;

/**
 * Where the kernel keeps the content of files (MK-041, ADR-0029): a directory of the server or an
 * S3-compatible bucket, chosen with {@code mosaikit.files.store}. A store knows keys and bytes only;
 * {@link FileService} decides who reads what, and keeps the metadata in the database.
 *
 * <p>Keys are {@code <organization>/<extension>/<file id>}, made by {@link #key}: one prefix per
 * organization, then one per extension. A store never lists nor deletes by prefix.
 */
public interface FileStore {

    /** The key of a file: {@code <organization>/<extension>/<file id>}. */
    static String key(UUID organization, String extension, UUID file) {
        return organization + "/" + extension + "/" + file;
    }

    /** What the logs say of the store: its kind and location, never its credentials. */
    String describe();

    /**
     * Stores the content of a file under a key, replacing what was there.
     *
     * @param content a file of the server with the whole content, which the store may move away
     * @param size its size in bytes
     * @param contentType the media type of the content
     */
    void put(String key, Path content, long size, String contentType) throws IOException;

    /**
     * Opens a part of the content of a file, streamed: the caller closes the stream.
     *
     * @param offset the first byte
     * @param length how many bytes, at least one
     * @throws java.nio.file.NoSuchFileException when the store has no such key
     */
    InputStream read(String key, long offset, long length) throws IOException;

    /** Deletes the content of a file; deleting a key that is not there does nothing. */
    void delete(String key) throws IOException;
}
