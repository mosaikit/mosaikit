// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.channels.Channels;
import java.nio.channels.SeekableByteChannel;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;

/**
 * Files in a directory of the server (MK-041): the default of the portable distribution and of the
 * tests, and fine for an installation on one node. A key is a relative path under the directory.
 */
public class FilesystemFileStore implements FileStore {

    private final Path directory;

    public FilesystemFileStore(Path directory) {
        this.directory = directory.toAbsolutePath().normalize();
    }

    @Override
    public String describe() {
        return "the directory " + directory;
    }

    @Override
    public void put(String key, Path content, long size, String contentType) throws IOException {
        Path target = resolve(key);
        Files.createDirectories(target.getParent());
        // A temporary name next to the target, then a rename: a reader never sees half a file.
        Path partial = target.resolveSibling(target.getFileName() + ".partial");
        Files.move(content, partial, StandardCopyOption.REPLACE_EXISTING);
        try {
            Files.move(partial, target, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(partial, target, StandardCopyOption.REPLACE_EXISTING);
        }
    }

    @Override
    public InputStream read(String key, long offset, long length) throws IOException {
        SeekableByteChannel channel = Files.newByteChannel(resolve(key), StandardOpenOption.READ);
        try {
            channel.position(offset);
        } catch (IOException e) {
            channel.close();
            throw e;
        }
        return new Bounded(Channels.newInputStream(channel), length);
    }

    @Override
    public void delete(String key) throws IOException {
        Files.deleteIfExists(resolve(key));
    }

    /** The path of a key, refused when it would leave the directory. */
    Path resolve(String key) {
        Path path = directory.resolve(key).normalize();
        if (!path.startsWith(directory) || path.equals(directory)) {
            throw new IllegalArgumentException("Not a key of the store: " + key);
        }
        return path;
    }

    /** A stream that ends after a number of bytes. */
    static final class Bounded extends FilterInputStream {

        private long left;

        Bounded(InputStream in, long length) {
            super(in);
            this.left = length;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) {
                return -1;
            }
            int b = super.read();
            if (b >= 0) {
                left--;
            }
            return b;
        }

        @Override
        public int read(byte[] buffer, int offset, int length) throws IOException {
            if (left <= 0) {
                return -1;
            }
            int read = super.read(buffer, offset, (int) Math.min(length, left));
            if (read > 0) {
                left -= read;
            }
            return read;
        }

        @Override
        public long skip(long n) throws IOException {
            long skipped = super.skip(Math.min(n, left));
            left -= skipped;
            return skipped;
        }

        @Override
        public int available() throws IOException {
            return (int) Math.min(super.available(), left);
        }

        @Override
        public boolean markSupported() {
            return false;
        }
    }
}
