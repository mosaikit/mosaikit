// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import java.util.Map;

/**
 * A tool as returned by the API.
 *
 * @param name name to invoke it with
 * @param title short human readable name
 * @param description what it does
 * @param risk {@code read}, {@code write} or {@code execute}
 * @param needsConfirmation whether invoking it produces a draft that the person confirms
 * @param plugin identifier of the plugin that offers it
 * @param inputSchema JSON Schema of the arguments
 */
public record ToolView(
        String name,
        String title,
        String description,
        String risk,
        boolean needsConfirmation,
        String plugin,
        Map<String, Object> inputSchema) {

    static ToolView of(AiTool tool) {
        return new ToolView(
                tool.name(),
                tool.action().title(),
                tool.action().description(),
                tool.action().risk().value(),
                tool.needsConfirmation(),
                tool.plugin(),
                tool.action().input().tree());
    }
}
