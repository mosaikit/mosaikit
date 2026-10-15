// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import dev.mosaikit.kernel.api.extension.ExtensionKind;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.core.search.SearchProviders;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;

/**
 * Administrative view of an installed extension.
 *
 * @param publisherKey identifier of the trusted key that signed the package, {@code null} when the
 *     publisher is not verified (MK-013)
 * @param warnings what still works but should change, such as a deprecated extension point
 */
public record ExtensionView(
        String id,
        String version,
        String name,
        String description,
        Set<String> kinds,
        String platform,
        ExtensionStatus status,
        List<String> problems,
        String publisherKey,
        List<String> warnings) {

    /** The extension point that rail.app replaces (ADR-0026). */
    static final String LAUNCHER_POINT = "launcher.app";

    static final String LAUNCHER_DEPRECATED =
            "launcher.app is deprecated: contribute the app to rail.app (ADR-0026); the shell still shows it";

    static ExtensionView of(InstalledExtension extension) {
        return extension
                .manifest()
                .map(manifest -> fromManifest(manifest, extension))
                .orElseGet(() -> new ExtensionView(
                        extension.key(),
                        null,
                        extension.key(),
                        "",
                        Set.of(),
                        null,
                        extension.status(),
                        extension.problems(),
                        null,
                        List.of()));
    }

    private static ExtensionView fromManifest(ExtensionManifest manifest, InstalledExtension extension) {
        return new ExtensionView(
                manifest.id(),
                manifest.version().toString(),
                manifest.name(),
                manifest.description(),
                manifest.kinds().stream().map(ExtensionKind::value).collect(Collectors.toCollection(TreeSet::new)),
                manifest.platform().toString(),
                extension.status(),
                extension.problems(),
                extension.publisherKey().orElse(null),
                warnings(manifest));
    }

    /** The deprecated launcher.app, and the search providers that the kernel ignores (MK-040). */
    private static List<String> warnings(ExtensionManifest manifest) {
        List<String> warnings = new ArrayList<>();
        if (!manifest.contributionsTo(LAUNCHER_POINT).isEmpty()) {
            warnings.add(LAUNCHER_DEPRECATED);
        }
        warnings.addAll(SearchProviders.problems(manifest));
        return List.copyOf(warnings);
    }
}
