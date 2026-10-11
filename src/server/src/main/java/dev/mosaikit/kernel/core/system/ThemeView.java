// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.system;

import java.util.Map;

/**
 * A theme of an active theme plugin (MK-028), for the shell.
 *
 * @param id the identifier of the plugin, which people choose and installations name
 * @param title the name of the theme
 * @param font the font stack, or {@code null} for the default
 * @param radius the radius of controls in pixels, or {@code null} for the default
 * @param light colors of the light scheme
 * @param dark colors of the dark scheme
 */
public record ThemeView(
        String id, String title, String font, Integer radius, Map<String, String> light, Map<String, String> dark) {}
