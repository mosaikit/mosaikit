// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import dev.mosaikit.kernel.api.plugin.PluginManifest;
import java.nio.file.Path;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * A plugin found in the installation directory, with the result of its checks.
 *
 * @param key plugin identifier, or the directory name when the manifest cannot be read
 * @param directory root directory of the plugin
 * @param manifest the manifest, present unless the plugin is {@link PluginStatus#INVALID}
 * @param status outcome of the checks
 * @param problems human readable reasons for a status other than {@link PluginStatus#ACTIVE}
 * @param publisherKey identifier of the trusted key that signed the package of the plugin; empty
 *     for a plugin directory, an unsigned package or a key the installation does not trust (MK-013)
 */
public record InstalledPlugin(
        String key,
        Path directory,
        Optional<PluginManifest> manifest,
        PluginStatus status,
        List<String> problems,
        Optional<String> publisherKey) {

    public InstalledPlugin {
        Objects.requireNonNull(key, "key");
        Objects.requireNonNull(directory, "directory");
        Objects.requireNonNull(status, "status");
        manifest = Objects.requireNonNullElse(manifest, Optional.empty());
        problems = List.copyOf(problems);
        publisherKey = Objects.requireNonNullElse(publisherKey, Optional.empty());
    }

    /** A plugin whose publisher is not verified. */
    public InstalledPlugin(
            String key, Path directory, Optional<PluginManifest> manifest, PluginStatus status, List<String> problems) {
        this(key, directory, manifest, status, problems, Optional.empty());
    }

    /** Whether a key trusted by the installation signed the package of the plugin. */
    public boolean isVerified() {
        return publisherKey.isPresent();
    }

    /** This plugin, published by the owner of a trusted key. */
    InstalledPlugin verifiedBy(String keyId) {
        return new InstalledPlugin(key, directory, manifest, status, problems, Optional.of(keyId));
    }

    /** The declared JAR of the plugin, resolved inside its directory, if it brings Java code. */
    public Optional<Path> backendJar() {
        return manifest.flatMap(PluginManifest::backend).map(backend -> directory.resolve(backend.jar()));
    }

    /** Returns {@code true} when the plugin can be used. */
    public boolean isActive() {
        return status == PluginStatus.ACTIVE;
    }
}
