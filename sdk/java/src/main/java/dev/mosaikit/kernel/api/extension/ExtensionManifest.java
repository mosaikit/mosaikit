// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import dev.mosaikit.kernel.api.version.Version;
import dev.mosaikit.kernel.api.version.VersionRange;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;

/**
 * A validated extension manifest.
 *
 * <p>Instances are created by {@link ExtensionManifests#parse(Map)}, which guarantees that every
 * rule of the contract holds. The class is immutable.
 */
public final class ExtensionManifest {

    private final String id;
    private final Version version;
    private final String name;
    private final String description;
    private final Set<ExtensionKind> kinds;
    private final VersionRange platform;
    private final Map<String, VersionRange> requires;
    private final FrontendEntry frontend;
    private final BackendEntry backend;
    private final DatabaseEntry database;
    private final DataEntry data;
    private final ThemeEntry theme;
    private final List<Contribution> contributions;
    private final List<ActionEntry> actions;

    @SuppressWarnings("java:S107") // Mirrors the manifest fields; only ExtensionManifests creates it.
    ExtensionManifest(
            String id,
            Version version,
            String name,
            String description,
            Set<ExtensionKind> kinds,
            VersionRange platform,
            Map<String, VersionRange> requires,
            FrontendEntry frontend,
            BackendEntry backend,
            DatabaseEntry database,
            DataEntry data,
            ThemeEntry theme,
            List<Contribution> contributions,
            List<ActionEntry> actions) {
        this.id = Objects.requireNonNull(id, "id");
        this.version = Objects.requireNonNull(version, "version");
        this.name = Objects.requireNonNull(name, "name");
        this.description = Objects.requireNonNullElse(description, "");
        this.kinds = Set.copyOf(kinds);
        this.platform = Objects.requireNonNull(platform, "platform");
        this.requires = Map.copyOf(requires);
        this.frontend = frontend;
        this.backend = backend;
        this.database = database;
        this.data = data;
        this.theme = theme;
        this.contributions = List.copyOf(contributions);
        this.actions = List.copyOf(actions);
    }

    /** Typed actions that an assistant can use (MK-015). */
    public List<ActionEntry> actions() {
        return actions;
    }

    /** Stable reverse-DNS identifier, for example {@code dev.mosaikit.sample.hello}. */
    public String id() {
        return id;
    }

    /** Version of the extension. */
    public Version version() {
        return version;
    }

    /** Human readable name. */
    public String name() {
        return name;
    }

    /** Short description, possibly empty. */
    public String description() {
        return description;
    }

    /** What the extension brings; never empty. */
    public Set<ExtensionKind> kinds() {
        return kinds;
    }

    /** Range of kernel versions the extension runs on. */
    public VersionRange platform() {
        return platform;
    }

    /** Required extension points or extensions, with their accepted versions. */
    public Map<String, VersionRange> requires() {
        return requires;
    }

    /** Frontend of the extension, if any. */
    public Optional<FrontendEntry> frontend() {
        return Optional.ofNullable(frontend);
    }

    /** Java code of the extension, if any. */
    public Optional<BackendEntry> backend() {
        return Optional.ofNullable(backend);
    }

    /** Database schema owned by the extension, if any. */
    public Optional<DatabaseEntry> database() {
        return Optional.ofNullable(database);
    }

    /** Collections of documents that the extension keeps in the kernel, if any (ADR-0031). */
    public Optional<DataEntry> data() {
        return Optional.ofNullable(data);
    }

    /** The theme of an extension of kind theme (MK-028). */
    public Optional<ThemeEntry> theme() {
        return Optional.ofNullable(theme);
    }

    /** Contributions to extension points. */
    public List<Contribution> contributions() {
        return contributions;
    }

    /** Returns {@code true} if this extension can run on the given kernel version. */
    public boolean supportsPlatform(Version kernelVersion) {
        return platform.contains(kernelVersion);
    }

    /** Returns the contributions of this extension to one extension point. */
    public List<Contribution> contributionsTo(String point) {
        return contributions.stream()
                .filter(contribution -> contribution.point().equals(point))
                .toList();
    }

    @Override
    public String toString() {
        return id + "@" + version;
    }
}
