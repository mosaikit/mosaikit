// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.version.Version;
import dev.mosaikit.kernel.api.version.VersionRange;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The dependencies between a set of extensions (MK-132, ADR-0004): which required ones are missing
 * or in a version outside their range, which extensions require or optionally use another one, and
 * what an operation (installing, updating or removing several extensions together) would break.
 *
 * <p>Required dependencies ({@code requires}) are needed to install and start an extension; optional
 * ones ({@code optional}) are never needed, and are listed only to tell who uses an extension. The
 * class is immutable and has no framework dependency: the catalog of the extensions directory, the
 * marketplace and the settings of organizations use the same rules and the same explanations.
 */
public final class ExtensionDependencies {

    /** Why a required dependency is not satisfied. */
    public enum Reason {
        /** No extension with that id is installed. */
        NOT_INSTALLED,
        /** Installed in an accepted version, but not active. */
        NOT_ACTIVE,
        /** Installed in a version outside the range. */
        OUT_OF_RANGE
    }

    /**
     * A required dependency of an extension that is not satisfied.
     *
     * @param extension the extension that requires it
     * @param id the required extension
     * @param range the versions it accepts
     * @param reason why it is not satisfied
     * @param found the version installed, when there is one
     */
    public record Unmet(String extension, String id, VersionRange range, Reason reason, Optional<Version> found) {

        public Unmet {
            Objects.requireNonNull(extension, "extension");
            Objects.requireNonNull(id, "id");
            Objects.requireNonNull(range, "range");
            Objects.requireNonNull(reason, "reason");
            found = Objects.requireNonNullElse(found, Optional.empty());
        }

        /** The explanation shown for the extension, the same at install and at start. */
        @Override
        public String toString() {
            String requirement = "Requires extension " + id + " " + range;
            return switch (reason) {
                case NOT_INSTALLED -> requirement + ", which is not installed";
                case NOT_ACTIVE -> requirement + ", which is not active";
                case OUT_OF_RANGE ->
                    requirement + ", found " + found.map(Version::toString).orElse("none");
            };
        }
    }

    /**
     * An extension that declares a dependency on another one.
     *
     * @param id the extension that depends
     * @param version its version
     * @param range the versions of the other extension it accepts
     */
    public record Dependent(String id, Version version, VersionRange range) {

        @Override
        public String toString() {
            return id + " " + version + " (requires " + range + ")";
        }
    }

    private final Map<String, ExtensionManifest> manifests;

    private ExtensionDependencies(Map<String, ExtensionManifest> manifests) {
        this.manifests = manifests;
    }

    /** The dependencies between these manifests; of two with the same id the first is kept. */
    public static ExtensionDependencies of(Collection<ExtensionManifest> manifests) {
        Map<String, ExtensionManifest> byId = new LinkedHashMap<>();
        manifests.forEach(manifest -> byId.putIfAbsent(manifest.id(), manifest));
        return new ExtensionDependencies(byId);
    }

    /**
     * The extensions installed in a directory as other extensions see them: those with a readable
     * manifest, active or not, except the {@link ExtensionStatus#INVALID} ones (a duplicate, a refused
     * package), which the kernel never uses.
     */
    public static ExtensionDependencies installed(Collection<InstalledExtension> extensions) {
        return of(extensions.stream()
                .filter(extension -> extension.status() != ExtensionStatus.INVALID)
                .flatMap(extension -> extension.manifest().stream())
                .toList());
    }

    /**
     * The extensions that run or will run after the next start: active, or waiting for the restart
     * that builds their Java code. Those that cannot run (another kernel, a missing requirement) are
     * left out: removing what they need changes nothing for them.
     */
    public static ExtensionDependencies running(Collection<InstalledExtension> extensions) {
        return of(extensions.stream()
                .filter(extension -> extension.status() == ExtensionStatus.ACTIVE
                        || extension.status() == ExtensionStatus.RESTART_REQUIRED)
                .flatMap(extension -> extension.manifest().stream())
                .toList());
    }

    /** The manifest of an extension of the set. */
    public Optional<ExtensionManifest> find(String id) {
        return Optional.ofNullable(manifests.get(id));
    }

    /** The set with these manifests added, each replacing the one with the same id. */
    public ExtensionDependencies with(Collection<ExtensionManifest> added) {
        Map<String, ExtensionManifest> next = new LinkedHashMap<>(manifests);
        added.forEach(manifest -> next.put(manifest.id(), manifest));
        return new ExtensionDependencies(next);
    }

    /** The set without these extensions. */
    public ExtensionDependencies without(Collection<String> removed) {
        Map<String, ExtensionManifest> next = new LinkedHashMap<>(manifests);
        removed.forEach(next::remove);
        return new ExtensionDependencies(next);
    }

    /** The required dependencies of an extension that this set does not satisfy, in their order. */
    public List<Unmet> unmet(ExtensionManifest manifest) {
        return unmet(manifest, id -> Optional.ofNullable(manifests.get(id)), Set.of());
    }

    /**
     * The required dependencies of an extension that the active extensions do not satisfy: the rule
     * of the kernel at start (ADR-0004). A dependency that is installed but not active is told apart
     * from one that is not installed at all.
     *
     * @param active the active extensions, by id
     * @param installed the ids of every extension installed, active or not
     */
    public static List<Unmet> unmet(
            ExtensionManifest manifest, Map<String, ExtensionManifest> active, Set<String> installed) {
        return unmet(manifest, id -> Optional.ofNullable(active.get(id)), installed);
    }

    private static List<Unmet> unmet(
            ExtensionManifest manifest, Function<String, Optional<ExtensionManifest>> lookup, Set<String> installed) {
        List<Unmet> unmet = new ArrayList<>();
        manifest.requires().forEach((id, range) -> {
            Optional<ExtensionManifest> provider = lookup.apply(id);
            if (provider.isEmpty()) {
                Reason reason = installed.contains(id) ? Reason.NOT_ACTIVE : Reason.NOT_INSTALLED;
                unmet.add(new Unmet(manifest.id(), id, range, reason, Optional.empty()));
            } else if (!range.contains(provider.get().version())) {
                unmet.add(new Unmet(
                        manifest.id(),
                        id,
                        range,
                        Reason.OUT_OF_RANGE,
                        Optional.of(provider.get().version())));
            }
        });
        return unmet;
    }

    /** The extensions of the set that require an extension, by id. */
    public List<Dependent> requiredBy(String id) {
        return dependents(id, ExtensionManifest::requires);
    }

    /** The extensions of the set that use an extension optionally, by id. */
    public List<Dependent> usedOptionallyBy(String id) {
        return dependents(id, ExtensionManifest::optional);
    }

    private List<Dependent> dependents(String id, Function<ExtensionManifest, Map<String, VersionRange>> declared) {
        return manifests.values().stream()
                .filter(manifest -> declared.apply(manifest).containsKey(id))
                .map(manifest -> new Dependent(
                        manifest.id(),
                        manifest.version(),
                        declared.apply(manifest).get(id)))
                .sorted(Comparator.comparing(Dependent::id))
                .toList();
    }

    /**
     * Why installing or updating these extensions together would break a required dependency, empty
     * when it would not (MK-132). Each one must find what it requires in the set it joins, the other
     * extensions of the operation included; and an update must stay in the range of every extension
     * that requires it, unless that extension is updated in the same operation to a version that
     * accepts it. Problems the set already had, unrelated to the operation, are not reported.
     *
     * @param operation the manifests of the packages installed together
     */
    public List<String> refuseInstallation(Collection<ExtensionManifest> operation) {
        Set<String> ids = operation.stream().map(ExtensionManifest::id).collect(Collectors.toSet());
        ExtensionDependencies after = with(operation);
        Set<String> problems = new LinkedHashSet<>();
        for (ExtensionManifest manifest : operation) {
            List<Unmet> unmet = after.unmet(manifest);
            if (!unmet.isEmpty()) {
                problems.add(manifest.id() + " " + manifest.version() + ": "
                        + unmet.stream().map(Unmet::toString).collect(Collectors.joining("; ")));
            }
        }
        for (ExtensionManifest manifest : operation) {
            Optional<ExtensionManifest> current = find(manifest.id());
            if (current.isEmpty() || current.get().version().equals(manifest.version())) {
                continue;
            }
            Version before = current.get().version();
            // A dependent updated in the same operation is checked above with its new range; one that
            // did not accept the current version either is not broken by the update.
            List<Dependent> broken = after.requiredBy(manifest.id()).stream()
                    .filter(dependent -> !ids.contains(dependent.id()))
                    .filter(dependent -> dependent.range().contains(before))
                    .filter(dependent -> !dependent.range().contains(manifest.version()))
                    .toList();
            if (!broken.isEmpty()) {
                problems.add("updating " + manifest.id() + " from " + before + " to "
                        + manifest.version() + " takes it out of the range of "
                        + broken.stream().map(Dependent::toString).collect(Collectors.joining(", "))
                        + ": update " + (broken.size() == 1 ? "it" : "them") + " in the same operation");
            }
        }
        return List.copyOf(problems);
    }

    /**
     * Why removing these extensions would leave an extension of the set without what it requires,
     * empty when it would not (MK-132). Extensions removed together may require each other; those
     * that use them optionally stay.
     */
    public List<String> refuseRemoval(Collection<String> removed) {
        List<String> problems = new ArrayList<>();
        for (String id : removed) {
            List<Dependent> dependents = requiredBy(id).stream()
                    .filter(dependent -> !removed.contains(dependent.id()))
                    .toList();
            if (!dependents.isEmpty()) {
                problems.add(id + " is required by "
                        + dependents.stream().map(Dependent::toString).collect(Collectors.joining(", ")));
            }
        }
        return problems;
    }
}
