// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

/**
 * What the plugin answered to a tool.
 *
 * @param status HTTP status
 * @param body the JSON body as a tree of maps and lists, a string for other content, or {@code
 *     null} when empty
 */
public record PluginResponse(int status, Object body) {

    /** Whether the plugin did what was asked. */
    public boolean succeeded() {
        return status < 400;
    }
}
