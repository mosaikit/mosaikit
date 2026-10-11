// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.launcher;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.List;
import java.util.stream.Stream;

/**
 * A copy of what a rebuild changes: the output of the Quarkus augmentation ({@code kernel/quarkus},
 * {@code kernel/quarkus-run.jar}) and the providers directory. Restoring it brings the kernel
 * back to its last build in a moment, without rebuilding.
 */
final class KernelSnapshot {

    private static final String DIRECTORY = ".rollback";
    private static final List<String> PARTS = List.of("quarkus", "quarkus-run.jar", "providers");

    private final Path kernel;
    private final Path snapshot;

    KernelSnapshot(Installation installation) {
        this.kernel = installation.kernel();
        this.snapshot = kernel.resolve(DIRECTORY);
    }

    /** Replaces the snapshot with the current build. */
    void save() {
        delete(snapshot);
        for (String part : PARTS) {
            copy(kernel.resolve(part), snapshot.resolve(part));
        }
    }

    boolean exists() {
        return Files.isDirectory(snapshot);
    }

    /** Puts the saved build back in place. */
    void restore() {
        if (!exists()) {
            throw new IllegalStateException("No previous build to restore in " + snapshot);
        }
        for (String part : PARTS) {
            delete(kernel.resolve(part));
            copy(snapshot.resolve(part), kernel.resolve(part));
        }
    }

    private static void copy(Path source, Path target) {
        if (!Files.exists(source)) {
            return;
        }
        try (Stream<Path> paths = Files.walk(source)) {
            for (Path path : paths.toList()) {
                Path destination = target.resolve(source.relativize(path).toString());
                if (Files.isDirectory(path)) {
                    Files.createDirectories(destination);
                } else {
                    Files.createDirectories(destination.getParent());
                    Files.copy(
                            path, destination, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.COPY_ATTRIBUTES);
                }
            }
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot copy " + source + " to " + target, e);
        }
    }

    private static void delete(Path path) {
        if (!Files.exists(path)) {
            return;
        }
        try (Stream<Path> paths = Files.walk(path)) {
            for (Path file : paths.sorted(Comparator.reverseOrder()).toList()) {
                Files.delete(file);
            }
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot delete " + path, e);
        }
    }
}
