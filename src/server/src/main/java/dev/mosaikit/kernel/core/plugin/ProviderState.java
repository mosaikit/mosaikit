// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.Objects;

/**
 * A set of plugin JARs recorded by the launcher in the providers directory, one line per JAR:
 * {@code <sha-256> <plugin id>}. Three files use this format:
 *
 * <ul>
 *   <li>{@link #FILE_NAME}: the JARs built into the kernel. The kernel trusts only this file, so
 *       that a JAR copied into the directory without rebuilding is never reported as loaded.
 *   <li>{@link #PENDING_FILE}: the JARs added or updated by the last rebuild, until the kernel has
 *       started with them; if it never does, the launcher rolls them back.
 *   <li>{@link #REJECTED_FILE}: the JARs rolled back, never loaded again.
 * </ul>
 *
 * @param entries the JARs, in the order of the file
 */
public record ProviderState(List<Entry> entries) {

    /** JARs built into the kernel. */
    public static final String FILE_NAME = "mosaikit-providers.txt";

    /** JARs of the last rebuild that the kernel has not yet started with. */
    public static final String PENDING_FILE = "mosaikit-pending.txt";

    /** JARs that were rolled back because the kernel did not rebuild or start with them. */
    public static final String REJECTED_FILE = "mosaikit-rejected.txt";

    private static final String HEADER = "# Plugin JARs recorded by the mosaikit launcher. Do not edit.";

    /** A JAR built into the kernel. */
    public record Entry(String sha256, String pluginId) {

        public Entry {
            Objects.requireNonNull(sha256, "sha256");
            Objects.requireNonNull(pluginId, "pluginId");
        }
    }

    public ProviderState {
        entries = List.copyOf(entries);
    }

    /** Reads the JARs built into the kernel; empty when the kernel was never rebuilt. */
    public static ProviderState read(Path providersDirectory) {
        return read(providersDirectory, FILE_NAME);
    }

    /** Reads one of the files of the providers directory; empty when it does not exist. */
    public static ProviderState read(Path providersDirectory, String fileName) {
        Path file = providersDirectory.resolve(fileName);
        if (!Files.isRegularFile(file)) {
            return new ProviderState(List.of());
        }
        List<Entry> entries = new ArrayList<>();
        try {
            for (String line : Files.readAllLines(file, StandardCharsets.UTF_8)) {
                String trimmed = line.strip();
                if (trimmed.isEmpty() || trimmed.startsWith("#")) {
                    continue;
                }
                String[] fields = trimmed.split("\\s+");
                if (fields.length == 2) {
                    entries.add(new Entry(fields[0], fields[1]));
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read " + file, e);
        }
        return new ProviderState(entries);
    }

    /** Records the JARs built into the kernel, replacing the previous record. */
    public void write(Path providersDirectory) {
        write(providersDirectory, FILE_NAME);
    }

    /** Writes one of the files of the providers directory, replacing it. */
    public void write(Path providersDirectory, String fileName) {
        List<String> lines = new ArrayList<>();
        lines.add(HEADER);
        entries.forEach(entry -> lines.add(entry.sha256() + " " + entry.pluginId()));
        try {
            Files.write(providersDirectory.resolve(fileName), lines, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot write the state of " + providersDirectory, e);
        }
    }

    /** Removes the record of the JARs built into the kernel. */
    public static void clear(Path providersDirectory) {
        clear(providersDirectory, FILE_NAME);
    }

    /** Removes one of the files of the providers directory. */
    public static void clear(Path providersDirectory, String fileName) {
        try {
            Files.deleteIfExists(providersDirectory.resolve(fileName));
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot clear the state of " + providersDirectory, e);
        }
    }

    /** Returns {@code true} when this exact JAR of the plugin is in the set. */
    public boolean contains(String pluginId, String sha256) {
        return entries.contains(new Entry(sha256, pluginId));
    }

    /** Returns {@code true} when the set is empty. */
    public boolean isEmpty() {
        return entries.isEmpty();
    }

    /** The union of this set and another, without duplicates. */
    public ProviderState with(ProviderState other) {
        List<Entry> union = new ArrayList<>(entries);
        other.entries.stream().filter(entry -> !union.contains(entry)).forEach(union::add);
        return new ProviderState(union);
    }

    /** SHA-256 of a file, in lowercase hexadecimal. */
    public static String sha256(Path file) {
        try (InputStream in = Files.newInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            for (int read = in.read(buffer); read >= 0; read = in.read(buffer)) {
                digest.update(buffer, 0, read);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read " + file, e);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by every Java platform", e);
        }
    }
}
