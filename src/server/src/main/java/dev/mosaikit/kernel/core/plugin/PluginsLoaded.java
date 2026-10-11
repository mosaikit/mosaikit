// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import java.util.List;

/**
 * Fired once at start, after the plugins have been read and before the kernel accepts requests.
 *
 * @param active the plugins that can be used
 */
public record PluginsLoaded(List<InstalledPlugin> active) {

    public PluginsLoaded {
        active = List.copyOf(active);
    }
}
