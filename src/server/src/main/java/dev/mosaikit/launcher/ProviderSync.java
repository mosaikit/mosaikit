// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.launcher;

import dev.mosaikit.kernel.core.plugin.InstalledPlugin;
import dev.mosaikit.kernel.core.plugin.ProviderState;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Stream;

/**
 * Keeps the providers directory of the kernel in line with the Java plugins that can run.
 *
 * <p>Each plugin JAR is copied as {@code <plugin id>.jar}. The state file is written only after
 * the kernel has been rebuilt, so that a failed rebuild never leaves the kernel claiming to have
 * loaded code it does not contain.
 */
final class ProviderSync {

    private final Path providers;

    ProviderSync(Path providers) {
        this.providers = providers;
    }

    /**
     * What the providers directory must contain.
     *
     * @param desired every JAR to build into the kernel
     * @param added the JARs of {@code desired} that the kernel was not built with: added or updated
     * @param sources where to copy the JARs from
     * @param upToDate {@code true} when nothing has to change
     * @param changes human readable description of the changes
     */
    record Plan(
            ProviderState desired, ProviderState added, List<Source> sources, boolean upToDate, List<String> changes) {}

    /** A plugin JAR to copy into the providers directory. */
    record Source(String pluginId, Path jar) {}

    /** Compares the Java plugins that can run with what the kernel was built with. */
    Plan plan(List<InstalledPlugin> plugins) {
        List<Source> sources = plugins.stream()
                .filter(InstalledPlugin::isActive)
                .filter(plugin -> plugin.backendJar().isPresent())
                .map(plugin -> new Source(plugin.key(), plugin.backendJar().orElseThrow()))
                .sorted(Comparator.comparing(Source::pluginId))
                .toList();
        ProviderState desired = new ProviderState(sources.stream()
                .map(source -> new ProviderState.Entry(ProviderState.sha256(source.jar()), source.pluginId()))
                .toList());
        ProviderState current = ProviderState.read(providers);
        ProviderState added = new ProviderState(desired.entries().stream()
                .filter(entry -> !current.contains(entry.pluginId(), entry.sha256()))
                .toList());
        List<String> changes = describeChanges(current, desired);
        boolean upToDate = changes.isEmpty() && jarsMatch(desired);
        return new Plan(desired, added, sources, upToDate, upToDate ? List.of() : changes);
    }

    /** Replaces the plugin JARs of the providers directory; the state is cleared until {@link #commit}. */
    void apply(Plan plan) {
        try {
            Files.createDirectories(providers);
            ProviderState.clear(providers);
            try (Stream<Path> files = Files.list(providers)) {
                for (Path file : files.filter(ProviderSync::isJar).toList()) {
                    Files.delete(file);
                }
            }
            for (Source source : plan.sources()) {
                Files.copy(
                        source.jar(),
                        providers.resolve(fileName(source.pluginId())),
                        StandardCopyOption.REPLACE_EXISTING);
            }
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot update " + providers, e);
        }
    }

    /**
     * Records that the kernel has been rebuilt with the JARs of the plan. The added JARs stay
     * pending until the kernel has started with them.
     */
    void commit(Plan plan) {
        plan.desired().write(providers);
        if (plan.added().isEmpty()) {
            ProviderState.clear(providers, ProviderState.PENDING_FILE);
        } else {
            plan.added().write(providers, ProviderState.PENDING_FILE);
        }
    }

    private boolean jarsMatch(ProviderState desired) {
        return desired.entries().stream().allMatch(entry -> {
            Path copy = providers.resolve(fileName(entry.pluginId()));
            return Files.isRegularFile(copy) && ProviderState.sha256(copy).equals(entry.sha256());
        });
    }

    private static List<String> describeChanges(ProviderState current, ProviderState desired) {
        Set<String> changes = new TreeSet<>();
        Set<String> before = ids(current);
        Set<String> after = ids(desired);
        after.stream().filter(id -> !before.contains(id)).forEach(id -> changes.add("added " + id));
        before.stream().filter(id -> !after.contains(id)).forEach(id -> changes.add("removed " + id));
        desired.entries().stream()
                .filter(entry ->
                        before.contains(entry.pluginId()) && !current.contains(entry.pluginId(), entry.sha256()))
                .forEach(entry -> changes.add("updated " + entry.pluginId()));
        return List.copyOf(changes);
    }

    private static Set<String> ids(ProviderState state) {
        Set<String> ids = new TreeSet<>();
        state.entries().forEach(entry -> ids.add(entry.pluginId()));
        return ids;
    }

    static String fileName(String pluginId) {
        return pluginId + ".jar";
    }

    private static boolean isJar(Path file) {
        return Files.isRegularFile(file) && file.getFileName().toString().endsWith(".jar");
    }
}
