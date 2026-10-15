// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.launcher;

import dev.mosaikit.kernel.api.extension.LibraryEntry;
import dev.mosaikit.kernel.core.extension.ContractApis;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.extension.KernelLibraries;
import dev.mosaikit.kernel.core.extension.ProviderState;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.stream.Stream;

/**
 * Keeps the providers directory of the kernel in line with the Java extensions that can run.
 *
 * <p>Each extension JAR is copied as {@code <extension id>.jar}, and each library that the extensions
 * bring and the kernel does not provide (MK-131) as {@code <groupId>_<artifactId>_<version>.jar}, once
 * (the API artifact of a contract in the highest compatible version, MK-134)
 * whatever the number of extensions that bring it, for as long as one of them can run. The state file is written only after
 * the kernel has been rebuilt, so that a failed rebuild never leaves the kernel claiming to have
 * loaded code it does not contain.
 */
final class ProviderSync {

    private final Path providers;
    private final KernelLibraries kernelLibraries;

    ProviderSync(Path providers) {
        this(providers, KernelLibraries.none());
    }

    ProviderSync(Path providers, KernelLibraries kernelLibraries) {
        this.providers = providers;
        this.kernelLibraries = kernelLibraries;
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

    /**
     * A JAR to copy into the providers directory.
     *
     * @param extensionId the id of the extension, or {@link ProviderState#libraryId} for a library
     */
    record Source(String extensionId, Path jar) {

        boolean isLibrary() {
            return ProviderState.isLibrary(extensionId);
        }
    }

    /** Compares the Java extensions that can run with what the kernel was built with. */
    Plan plan(List<InstalledExtension> extensions) {
        Map<String, Source> byId = new TreeMap<>();
        List<InstalledExtension> java = extensions.stream()
                .filter(InstalledExtension::isActive)
                .filter(extension -> extension.backendJar().isPresent())
                .sorted(Comparator.comparing(InstalledExtension::key))
                .toList();
        // The API artifacts of contracts (MK-134): the highest of the compatible versions is copied.
        Set<String> apis = new TreeSet<>();
        java.forEach(extension -> apis.addAll(extension.manifest().orElseThrow().contractApis()));
        Map<String, LibraryEntry> highestApis = new TreeMap<>();
        Map<String, Path> apiJars = new TreeMap<>();
        java.forEach(extension -> {
            byId.put(
                    extension.key(),
                    new Source(extension.key(), extension.backendJar().orElseThrow()));
            for (LibraryEntry library : extension.manifest().orElseThrow().libraries()) {
                if (kernelLibraries.provides(library)) {
                    continue;
                }
                Path jar = extension.directory().resolve(library.jar());
                if (apis.contains(library.key())) {
                    LibraryEntry current = highestApis.get(library.key());
                    if (current == null || ContractApis.highest(current, library) != current) {
                        highestApis.put(library.key(), library);
                        apiJars.put(library.key(), jar);
                    }
                } else {
                    String id = ProviderState.libraryId(library);
                    byId.putIfAbsent(id, new Source(id, jar));
                }
            }
        });
        highestApis.forEach((key, library) -> {
            String id = ProviderState.libraryId(library);
            byId.put(id, new Source(id, apiJars.get(key)));
        });
        List<Source> sources = List.copyOf(byId.values());
        ProviderState desired = new ProviderState(sources.stream()
                .map(source -> new ProviderState.Entry(ProviderState.sha256(source.jar()), source.extensionId()))
                .toList());
        ProviderState current = ProviderState.read(providers);
        ProviderState added = new ProviderState(desired.entries().stream()
                .filter(entry -> !current.contains(entry.extensionId(), entry.sha256()))
                .toList());
        List<String> changes = describeChanges(current, desired);
        boolean upToDate = changes.isEmpty() && jarsMatch(desired);
        return new Plan(desired, added, sources, upToDate, upToDate ? List.of() : changes);
    }

    /** Replaces the extension JARs of the providers directory; the state is cleared until {@link #commit}. */
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
                        providers.resolve(fileName(source.extensionId())),
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
            Path copy = providers.resolve(fileName(entry.extensionId()));
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
                        before.contains(entry.extensionId()) && !current.contains(entry.extensionId(), entry.sha256()))
                .forEach(entry -> changes.add("updated " + entry.extensionId()));
        return List.copyOf(changes);
    }

    private static Set<String> ids(ProviderState state) {
        Set<String> ids = new TreeSet<>();
        state.entries().forEach(entry -> ids.add(entry.extensionId()));
        return ids;
    }

    static String fileName(String extensionId) {
        if (ProviderState.isLibrary(extensionId)) {
            // Extension ids have no '_': a library never takes the file of an extension.
            return extensionId.substring(ProviderState.LIBRARY_PREFIX.length()).replace(':', '_') + ".jar";
        }
        return extensionId + ".jar";
    }

    private static boolean isJar(Path file) {
        return Files.isRegularFile(file) && file.getFileName().toString().endsWith(".jar");
    }
}
