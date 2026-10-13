// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.apps;

import dev.mosaikit.kernel.core.security.Roles;
import java.util.Set;

/**
 * An app of the app bar of an organization, as its administrators see and set it (MK-030).
 *
 * @param extensionId the extension that contributes the app
 * @param appId the identifier of the app in its extension
 * @param title the title of the app, read-only
 * @param enabled whether the app appears; an extension with all its apps off refuses its API too
 * @param pinned whether people cannot hide it from their app bar
 * @param roles deprecated by {@code restricted}: {@code [organization-admin]} when the app is
 *     restricted, empty otherwise; read only when {@code restricted} is not given
 * @param restricted whether only the people who hold the permission of the app see it (MK-056):
 *     the administrators of the organization, and the people a profile, a team or a personal
 *     exception grants it to; otherwise everyone of the organization sees it
 * @param permission the permission of the app, {@code <extension>:use-<app>}, read-only
 */
public record AppView(
        String extensionId,
        String appId,
        String title,
        boolean enabled,
        boolean pinned,
        Set<String> roles,
        Boolean restricted,
        String permission) {

    public AppView {
        roles = roles == null ? Set.of() : Set.copyOf(roles);
        if (restricted == null) {
            // Before MK-056 an app was for some roles: for the administrators only is now restricted.
            restricted = roles.contains(Roles.ORGANIZATION_ADMIN) && !roles.contains(Roles.ORGANIZATION_USER);
        }
        // Roles other than those of the organization stay, for the settings to refuse them.
        if (Set.of(Roles.ORGANIZATION_ADMIN, Roles.ORGANIZATION_USER).containsAll(roles)) {
            roles = restricted ? Set.of(Roles.ORGANIZATION_ADMIN) : Set.of();
        }
    }

    /** Whether only the people who hold the permission of the app see it. */
    public boolean isRestricted() {
        return restricted;
    }
}
