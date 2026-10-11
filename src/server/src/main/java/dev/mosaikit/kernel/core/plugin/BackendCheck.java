// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import dev.mosaikit.kernel.api.plugin.PluginManifest;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

/**
 * Decides whether the Java code declared by a plugin can be used. The kernel accepts only code
 * that the launcher has loaded; the launcher accepts every declared JAR that exists and was not
 * rolled back.
 */
@FunctionalInterface
public interface BackendCheck {

    /**
     * @param manifest a valid manifest with a {@code backend} entry
     * @param jar the declared JAR, resolved inside the plugin directory
     * @return the reason why the plugin cannot be activated, or empty when it can
     */
    Optional<Problem> check(PluginManifest manifest, Path jar);

    /** Why the backend of a plugin cannot be used. */
    record Problem(PluginStatus status, String message) {}

    /** Accepts every declared JAR that exists. */
    static BackendCheck jarExists() {
        return (manifest, jar) -> Files.isRegularFile(jar)
                ? Optional.empty()
                : Optional.of(
                        new Problem(PluginStatus.INVALID, "Declared backend JAR not found: " + jar.getFileName()));
    }

    /** Accepts every declared JAR that exists and was not rolled back: what the launcher loads. */
    static BackendCheck available(ProviderState rejected) {
        BackendCheck exists = jarExists();
        return (manifest, jar) -> exists.check(manifest, jar)
                .or(() -> rejected.contains(manifest.id(), ProviderState.sha256(jar))
                        ? Optional.of(rolledBack())
                        : Optional.empty());
    }

    /** Accepts the JARs that the launcher loaded into the running kernel, as recorded in its state. */
    static BackendCheck loadedBy(ProviderState state, ProviderState rejected) {
        BackendCheck available = available(rejected);
        return (manifest, jar) -> available
                .check(manifest, jar)
                .or(
                        () -> state.contains(manifest.id(), ProviderState.sha256(jar))
                                ? Optional.empty()
                                : Optional.of(
                                        new Problem(
                                                PluginStatus.RESTART_REQUIRED,
                                                "The Java code of this version is not loaded: restart the kernel with the mosaikit launcher")));
    }

    /** Refuses every backend: for kernels started without the launcher, such as development mode. */
    static BackendCheck notLoaded() {
        BackendCheck exists = jarExists();
        return (manifest, jar) -> exists.check(manifest, jar)
                .or(() -> Optional.of(new Problem(
                        PluginStatus.RESTART_REQUIRED,
                        "Java plugins are loaded only when the kernel is started with the mosaikit launcher")));
    }

    private static Problem rolledBack() {
        return new Problem(
                PluginStatus.INVALID,
                "Rolled back: the kernel could not be rebuilt or started with this version of the plugin;"
                        + " see the output of the mosaikit launcher, then install a fixed version");
    }
}
