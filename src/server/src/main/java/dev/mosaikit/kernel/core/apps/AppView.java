// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.apps;

import java.util.Set;

/**
 * An app of the app bar of an organization, as its administrators see and set it (MK-030).
 *
 * @param pluginId the plugin that contributes the app
 * @param appId the identifier of the app in its plugin
 * @param title the title of the app, read-only
 * @param enabled whether the app appears; a plugin with all its apps off refuses its API too
 * @param pinned whether people cannot hide it from their app bar
 * @param roles the roles of the organization that see it; empty for everyone
 */
public record AppView(String pluginId, String appId, String title, boolean enabled, boolean pinned, Set<String> roles) {

    public AppView {
        roles = roles == null ? Set.of() : Set.copyOf(roles);
    }
}
