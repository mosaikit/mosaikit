// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.Locale;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Plugins delivered as one zip ({@code <name>.zip} in the plugins directory). A package is
 * unpacked into a work directory, again only when the zip changes, and is then read like a plugin
 * directory. The zip holds the content of a plugin directory at its root: {@code manifest.yaml},
 * and {@code lib/}, {@code db/}, {@code web/} when the plugin has them.
 *
 * <p>Unpacking refuses entries outside the target directory, and packages with too many entries or
 * too many bytes, so that a package cannot write elsewhere or fill the disk.
 */
public final class PluginPackages {

    /** Extension of plugin packages. */
    public static final String EXTENSION = ".zip";

    static final int MAX_ENTRIES = 10_000;
    static final long MAX_BYTES = 512L * 1024 * 1024;
    private static final String CHECKSUM_FILE = ".package.sha256";

    /** Tries of the move of an unpacked package into place. */
    private static final int MOVE_ATTEMPTS = 8;

    private PluginPackages() {}

    /** Whether the path is a plugin package. */
    public static boolean isPackage(Path path) {
        return Files.isRegularFile(path)
                && path.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(EXTENSION);
    }

    /**
     * Unpacks a package into {@code <workDirectory>/<package name without .zip>}, unless it is
     * already unpacked from the same zip.
     *
     * @return the directory of the unpacked plugin
     * @throws IOException if the zip cannot be read or is refused
     */
    public static Path unpack(Path zip, Path workDirectory) throws IOException {
        String name = zip.getFileName().toString();
        Path target = workDirectory.resolve(name.substring(0, name.length() - EXTENSION.length()));
        String checksum = sha256(zip);
        Path checksumFile = target.resolve(CHECKSUM_FILE);
        if (Files.isRegularFile(checksumFile)
                && Files.readString(checksumFile).strip().equals(checksum)) {
            return target;
        }
        Files.createDirectories(workDirectory);
        Path staging = Files.createTempDirectory(workDirectory, ".unpacking-");
        try {
            extract(zip, staging);
            Files.writeString(staging.resolve(CHECKSUM_FILE), checksum);
            deleteRecursively(target);
            move(staging, target);
            return target;
        } finally {
            deleteRecursively(staging);
        }
    }

    /**
     * Moves the unpacked directory in place. On Windows a directory just written can stay locked
     * for a moment, by an antivirus or the indexer: the move is tried again a few times.
     */
    private static void move(Path staging, Path target) throws IOException {
        for (int attempt = 1; ; attempt++) {
            try {
                Files.move(staging, target, StandardCopyOption.ATOMIC_MOVE);
                return;
            } catch (java.nio.file.FileSystemException e) {
                if (attempt == MOVE_ATTEMPTS) {
                    throw e;
                }
                try {
                    Thread.sleep(100L * attempt);
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw e;
                }
            }
        }
    }

    private static void extract(Path zip, Path target) throws IOException {
        Path root = target.toAbsolutePath().normalize();
        long bytes = 0;
        int entries = 0;
        try (ZipFile file = new ZipFile(zip.toFile())) {
            var iterator = file.entries();
            while (iterator.hasMoreElements()) {
                ZipEntry entry = iterator.nextElement();
                if (++entries > MAX_ENTRIES) {
                    throw new IOException("More than " + MAX_ENTRIES + " entries");
                }
                Path destination = root.resolve(entry.getName()).normalize();
                if (!destination.startsWith(root) || destination.equals(root)) {
                    throw new IOException("Entry outside the plugin directory: " + entry.getName());
                }
                if (entry.isDirectory()) {
                    Files.createDirectories(destination);
                    continue;
                }
                Files.createDirectories(destination.getParent());
                try (InputStream in = file.getInputStream(entry)) {
                    bytes += copyLimited(in, destination, MAX_BYTES - bytes);
                }
            }
        }
    }

    private static long copyLimited(InputStream in, Path destination, long remaining) throws IOException {
        try (var out = Files.newOutputStream(destination)) {
            byte[] buffer = new byte[64 * 1024];
            long written = 0;
            int read;
            while ((read = in.read(buffer)) >= 0) {
                written += read;
                if (written > remaining) {
                    throw new IOException("Package larger than " + MAX_BYTES + " bytes once unpacked");
                }
                out.write(buffer, 0, read);
            }
            return written;
        }
    }

    private static String sha256(Path file) throws IOException {
        try (InputStream in = new DigestInputStream(Files.newInputStream(file), digest())) {
            in.transferTo(OutputStream.nullOutputStream());
            return HexFormat.of()
                    .formatHex(((DigestInputStream) in).getMessageDigest().digest());
        }
    }

    private static MessageDigest digest() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is always available", e);
        }
    }

    private static void deleteRecursively(Path directory) {
        if (!Files.exists(directory)) {
            return;
        }
        try (Stream<Path> paths = Files.walk(directory)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.delete(path);
                } catch (IOException e) {
                    throw new UncheckedIOException(e);
                }
            });
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot delete " + directory, e);
        }
    }
}
