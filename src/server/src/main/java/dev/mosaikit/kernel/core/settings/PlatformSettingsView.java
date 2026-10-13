// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.settings;

import jakarta.validation.constraints.NotNull;

/**
 * The settings of the platform that administrators change from the interface.
 *
 * @param registration whether people can create their own local account, in the organizations that
 *     allow it, after confirming their email address
 */
public record PlatformSettingsView(@NotNull Boolean registration) {}
