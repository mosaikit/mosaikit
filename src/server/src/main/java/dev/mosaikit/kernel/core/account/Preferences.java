// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * The personal settings of a person (MK-027), kept with the account and applied by the shell at
 * every sign-in. A missing value means the default of the installation.
 *
 * @param theme a theme of the installation: {@code mosaikit}, {@code pa}, or the identifier of a
 *     theme plugin (MK-028); the shell uses the default when it is not available
 * @param appearance {@code system} (light or dark as the device), {@code light}, {@code dark} or
 *     {@code contrast} (high contrast)
 * @param language {@code en} or {@code it}
 * @param hiddenApps the apps the person does not want in the app bar, as {@code <plugin
 *     id>/<app id>}; pinned apps stay (MK-030)
 * @param mutedNotifications the kinds of notifications the person does not want, as {@code <plugin
 *     id>/<kind>} (MK-038)
 */
public record Preferences(
        @Pattern(regexp = "^[a-z0-9][a-z0-9.-]{0,99}$") String theme,
        @Pattern(regexp = "^(system|light|dark|contrast)$") String appearance,
        @Pattern(regexp = "^(en|it)$") String language,
        @Size(max = 100) List<String> hiddenApps,
        @Size(max = 100) List<String> mutedNotifications) {

    /** No setting chosen. */
    public static final Preferences NONE = new Preferences(null, null, null, List.of(), List.of());

    public Preferences {
        hiddenApps = hiddenApps == null ? List.of() : List.copyOf(hiddenApps);
        mutedNotifications = mutedNotifications == null ? List.of() : List.copyOf(mutedNotifications);
    }
}
