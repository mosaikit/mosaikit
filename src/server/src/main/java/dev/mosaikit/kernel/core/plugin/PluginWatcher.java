// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import dev.mosaikit.kernel.core.config.KernelConfig;
import io.quarkus.runtime.ShutdownEvent;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import java.io.IOException;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.Set;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import org.jboss.logging.Logger;

/**
 * With {@code mosaikit.plugins.watch}, reads the plugins directory again when one of its files
 * changes, so that a changed frontend shows at the next reload of the shell, which the shell does
 * by itself (see {@link PluginResource#revision()}). It compares the paths, sizes and times of the
 * files every second: simple, and the same on every operating system.
 */
@ApplicationScoped
public class PluginWatcher {

    private static final Logger LOG = Logger.getLogger(PluginWatcher.class);
    /** Dependencies and builds of plugin directories in development, not read by the kernel. */
    private static final Set<String> IGNORED = Set.of("node_modules", "target");

    private final PluginRegistry registry;
    private final boolean enabled;
    private ScheduledExecutorService executor;
    private long fingerprint;

    public PluginWatcher(PluginRegistry registry, KernelConfig config) {
        this.registry = registry;
        this.enabled = config.plugins().watch();
    }

    /** Whether the plugins directory is watched. */
    public boolean enabled() {
        return enabled;
    }

    void onStart(@Observes StartupEvent event) {
        if (!enabled) {
            return;
        }
        fingerprint = fingerprint(registry.directory());
        executor = Executors.newSingleThreadScheduledExecutor(
                Thread.ofPlatform().name("mosaikit-plugin-watcher").daemon().factory());
        executor.scheduleWithFixedDelay(this::check, 1, 1, TimeUnit.SECONDS);
        LOG.infof("Watching %s: changed plugins are read again at once", registry.directory());
    }

    void onStop(@Observes ShutdownEvent event) {
        if (executor != null) {
            executor.shutdownNow();
        }
    }

    void check() {
        try {
            long current = fingerprint(registry.directory());
            if (current != fingerprint) {
                fingerprint = current;
                registry.reload();
            }
        } catch (RuntimeException e) {
            LOG.warnf("The plugins directory cannot be read again: %s", e.getMessage());
        }
    }

    /**
     * A digest of the files of the directory. Hidden entries are skipped: the kernel unpacks
     * packages and keeps replaced ones in {@code .packages} and {@code .previous}.
     */
    static long fingerprint(Path directory) {
        if (!Files.isDirectory(directory)) {
            return 0;
        }
        long[] digest = {17};
        try {
            Files.walkFileTree(directory, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult preVisitDirectory(Path path, BasicFileAttributes attributes) {
                    return path.equals(directory) || visible(path)
                            ? FileVisitResult.CONTINUE
                            : FileVisitResult.SKIP_SUBTREE;
                }

                @Override
                public FileVisitResult visitFile(Path path, BasicFileAttributes attributes) {
                    if (visible(path)) {
                        long file = directory.relativize(path).toString().hashCode() * 31L
                                + attributes.size() * 17L
                                + attributes.lastModifiedTime().toMillis();
                        digest[0] = digest[0] * 1_000_003L ^ file;
                    }
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFileFailed(Path path, IOException e) {
                    return FileVisitResult.CONTINUE; // deleted while walking: the next check sees it
                }
            });
        } catch (IOException e) {
            return 0;
        }
        return digest[0];
    }

    private static boolean visible(Path path) {
        String name = path.getFileName().toString();
        return !name.startsWith(".") && !IGNORED.contains(name);
    }
}
