// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.apps;

/**
 * An app that the shell shows to the person of the request, in the order of the app bar (MK-030).
 *
 * @param extensionId the extension that contributes the app
 * @param appId the identifier of the app in its extension
 * @param pinned whether the person cannot hide it
 */
public record ShellApp(String extensionId, String appId, boolean pinned) {}
