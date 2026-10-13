// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.List;
import java.util.Map;

/**
 * The theme that an extension of kind theme brings (MK-028): values of the theme tokens for a light and
 * a dark scheme. Every value it leaves out comes from the default theme of the shell. A theme can also
 * name the product and bring its logo (MK-052), which the shell shows in place of those of Mosaikit when
 * the theme is the one of the installation.
 *
 * @param title the name people choose it by
 * @param font the font stack, or {@code null}
 * @param radius the radius of controls in pixels, 0 to 24, or {@code null}
 * @param light colors of the light scheme, by name ({@link #COLORS})
 * @param dark colors of the dark scheme, by name
 * @param product the name of the product, or {@code null} for Mosaikit
 * @param logo the logo for the light scheme, an SVG or PNG file of the extension, or {@code null}
 * @param logoDark the logo for the dark scheme, or {@code null} for {@code logo}
 */
public record ThemeEntry(
        String title,
        String font,
        Integer radius,
        Map<String, String> light,
        Map<String, String> dark,
        String product,
        String logo,
        String logoDark) {

    /** The colors a theme can set, as #rrggbb. */
    public static final List<String> COLORS = List.of(
            "brand", "background", "surface", "foreground", "muted", "line", "danger", "success", "warning", "focus");

    public ThemeEntry {
        light = Map.copyOf(light);
        dark = Map.copyOf(dark);
    }

    /** A theme of colors, font and radius only, without a product name or a logo. */
    public ThemeEntry(String title, String font, Integer radius, Map<String, String> light, Map<String, String> dark) {
        this(title, font, radius, light, dark, null, null, null);
    }
}
