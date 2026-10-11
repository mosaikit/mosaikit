// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

/** State of an installed plugin after the kernel has checked it. */
public enum PluginStatus {
    /** Valid, compatible and with every requirement satisfied. */
    ACTIVE,
    /** Valid, but not compatible with this kernel or missing a requirement. */
    INCOMPATIBLE,
    /** Valid, but its Java code is not part of the running kernel: start it through the launcher. */
    RESTART_REQUIRED,
    /** The manifest is missing, unreadable or breaks the contract. */
    INVALID
}
