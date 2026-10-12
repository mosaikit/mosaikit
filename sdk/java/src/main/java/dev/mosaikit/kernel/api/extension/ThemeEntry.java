// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.List;
import java.util.Map;

/**
 * The theme that an extension of kind theme brings (MK-028): values of the theme tokens for a light and
 * a dark scheme. Every value it leaves out comes from the default theme of the shell.
 *
 * @param title the name people choose it by
 * @param font the font stack, or {@code null}
 * @param radius the radius of controls in pixels, 0 to 24, or {@code null}
 * @param light colors of the light scheme, by name ({@link #COLORS})
 * @param dark colors of the dark scheme, by name
 */
public record ThemeEntry(
        String title, String font, Integer radius, Map<String, String> light, Map<String, String> dark) {

    /** The colors a theme can set, as #rrggbb. */
    public static final List<String> COLORS = List.of(
            "brand", "background", "surface", "foreground", "muted", "line", "danger", "success", "warning", "focus");

    public ThemeEntry {
        light = Map.copyOf(light);
        dark = Map.copyOf(dark);
    }
}
