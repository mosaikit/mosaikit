// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.system;

/**
 * Public information about the installation.
 *
 * @param name product name: Mosaikit, or the one the theme of the installation names (MK-052)
 * @param version kernel version
 * @param activeExtensions number of active extensions
 * @param theme the theme of the user interface ({@code mosaikit}, {@code pa})
 * @param rememberDays how many days "remember me" keeps a person signed in
 * @param logo URL of the logo of the product for the light scheme, or {@code null} for the one of
 *     Mosaikit (MK-052)
 * @param logoDark URL of the logo for the dark scheme, or {@code null} for {@code logo}
 */
public record SystemInfo(
        String name,
        String version,
        int activeExtensions,
        String theme,
        long rememberDays,
        String logo,
        String logoDark) {}
