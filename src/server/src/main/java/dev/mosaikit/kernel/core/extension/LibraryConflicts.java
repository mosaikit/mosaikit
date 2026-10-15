// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.LibraryEntry;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The libraries of an extension to install that the installation cannot hold (MK-131): one the kernel
 * provides in another version, or one that another active extension brings in another version. The
 * marketplace refuses such a package before placing it, naming the library and both versions; in an
 * operation on several extensions, the candidates must also agree with each other, and an installed
 * extension that the operation updates counts in its new version.
 */
public final class LibraryConflicts {

    private LibraryConflicts() {}

    /**
     * @param candidate the manifest of the extension to install
     * @param installed the extensions of the installation; the active ones other than the candidate count
     * @param kernelLibraries the libraries of the kernel
     * @return one message per conflict, empty when the libraries can be installed
     */
    public static List<String> of(
            ExtensionManifest candidate, List<InstalledExtension> installed, KernelLibraries kernelLibraries) {
        return of(List.of(candidate), installed, kernelLibraries);
    }

    /**
     * @param candidates the manifests of the extensions that one operation installs or updates
     * @param installed the extensions of the installation; the active ones that the operation does not
     *     replace count
     * @param kernelLibraries the libraries of the kernel
     * @return one message per conflict, empty when the libraries can be installed together
     */
    public static List<String> of(
            List<ExtensionManifest> candidates, List<InstalledExtension> installed, KernelLibraries kernelLibraries) {
        Set<String> replaced = candidates.stream().map(ExtensionManifest::id).collect(Collectors.toSet());
        List<InstalledExtension> others = installed.stream()
                .filter(InstalledExtension::isActive)
                .filter(other -> !replaced.contains(other.key()))
                .toList();
        List<String> conflicts = new ArrayList<>();
        for (int i = 0; i < candidates.size(); i++) {
            conflicts.addAll(conflicts(candidates.get(i), others, candidates.subList(0, i), kernelLibraries));
        }
        return conflicts;
    }

    private static List<String> conflicts(
            ExtensionManifest candidate,
            List<InstalledExtension> installed,
            List<ExtensionManifest> earlier,
            KernelLibraries kernelLibraries) {
        List<String> conflicts = new ArrayList<>();
        for (LibraryEntry library : candidate.libraries()) {
            var kernelVersion = kernelLibraries.version(library.key());
            if (kernelVersion.isPresent()) {
                if (!kernelVersion.get().equals(library.version())) {
                    conflicts.add(ExtensionCatalog.conflictWithKernel(library, kernelVersion.get()));
                }
                continue;
            }
            installed.stream()
                    .filter(InstalledExtension::isActive)
                    .filter(other -> !other.key().equals(candidate.id()))
                    .forEach(other -> other.manifest().orElseThrow().libraries().stream()
                            .filter(brought -> brought.key().equals(library.key()))
                            .filter(brought -> !brought.version().equals(library.version())
                                    || !brought.sha256().equals(library.sha256()))
                            .findFirst()
                            .ifPresent(brought -> conflicts.add(
                                    ExtensionCatalog.conflictWithExtension(library, brought, other.key()))));
            // One message per library: the first candidate of the operation that brings it otherwise.
            for (ExtensionManifest other : earlier) {
                var brought = other.libraries().stream()
                        .filter(entry -> entry.key().equals(library.key()))
                        .filter(entry -> !entry.version().equals(library.version())
                                || !entry.sha256().equals(library.sha256()))
                        .findFirst();
                if (brought.isPresent()) {
                    conflicts.add(ExtensionCatalog.conflictWithExtension(library, brought.get(), other.id()));
                    break;
                }
            }
        }
        return conflicts;
    }
}
