// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import java.util.List;

/**
 * Fired once at start, after the extensions have been read and before the kernel accepts requests.
 *
 * @param active the extensions that can be used
 */
public record ExtensionsLoaded(List<InstalledExtension> active) {

    public ExtensionsLoaded {
        active = List.copyOf(active);
    }
}
