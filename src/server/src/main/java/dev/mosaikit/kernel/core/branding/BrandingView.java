// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.branding;

import java.util.Map;

/**
 * The branding of an organization (MK-074), as the shell shows it: on the sign-in page of the
 * organization and after sign-in. Every value is {@code null} (and the tokens empty) when not set.
 *
 * @param displayName what the shell shows instead of the name of the product
 * @param accent the brand color of the light scheme, {@code #rrggbb}
 * @param light the tokens of the light scheme that the organization changed, by name
 * @param dark the tokens of the dark scheme that the organization changed, by name
 * @param logo the address of the logo for light backgrounds
 * @param logoDark the address of the logo for dark backgrounds
 * @param icon the address of the square mark
 * @param favicon the address of the icon of the page
 */
public record BrandingView(
        String displayName,
        String accent,
        Map<String, String> light,
        Map<String, String> dark,
        String logo,
        String logoDark,
        String icon,
        String favicon) {

    /** No branding: the shell shows the one of the installation. */
    public static final BrandingView NONE = new BrandingView(null, null, Map.of(), Map.of(), null, null, null, null);
}
