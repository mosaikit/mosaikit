// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import dev.mosaikit.kernel.api.plugin.PluginKind;
import dev.mosaikit.kernel.api.plugin.PluginManifest;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;

/**
 * Administrative view of an installed plugin.
 *
 * @param publisherKey identifier of the trusted key that signed the package, {@code null} when the
 *     publisher is not verified (MK-013)
 * @param warnings what still works but should change, such as a deprecated extension point
 */
public record PluginView(
        String id,
        String version,
        String name,
        String description,
        Set<String> kinds,
        String platform,
        PluginStatus status,
        List<String> problems,
        String publisherKey,
        List<String> warnings) {

    /** The extension point that rail.app replaces (ADR-0026). */
    static final String LAUNCHER_POINT = "launcher.app";

    static final String LAUNCHER_DEPRECATED =
            "launcher.app is deprecated: contribute the app to rail.app (ADR-0026); the shell still shows it";

    static PluginView of(InstalledPlugin plugin) {
        return plugin.manifest()
                .map(manifest -> fromManifest(manifest, plugin))
                .orElseGet(() -> new PluginView(
                        plugin.key(),
                        null,
                        plugin.key(),
                        "",
                        Set.of(),
                        null,
                        plugin.status(),
                        plugin.problems(),
                        null,
                        List.of()));
    }

    private static PluginView fromManifest(PluginManifest manifest, InstalledPlugin plugin) {
        return new PluginView(
                manifest.id(),
                manifest.version().toString(),
                manifest.name(),
                manifest.description(),
                manifest.kinds().stream().map(PluginKind::value).collect(Collectors.toCollection(TreeSet::new)),
                manifest.platform().toString(),
                plugin.status(),
                plugin.problems(),
                plugin.publisherKey().orElse(null),
                manifest.contributionsTo(LAUNCHER_POINT).isEmpty() ? List.of() : List.of(LAUNCHER_DEPRECATED));
    }
}
