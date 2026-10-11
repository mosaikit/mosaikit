// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.system;

/**
 * Public information about the installation.
 *
 * @param name product name
 * @param version kernel version
 * @param activePlugins number of active plugins
 * @param theme the theme of the user interface ({@code mosaikit}, {@code pa})
 * @param rememberDays how many days "remember me" keeps a person signed in
 */
public record SystemInfo(String name, String version, int activePlugins, String theme, long rememberDays) {}
