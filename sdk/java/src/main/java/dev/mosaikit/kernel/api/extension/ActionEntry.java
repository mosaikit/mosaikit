// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.Objects;

/**
 * A typed action of an extension that an assistant or an MCP client can use with the permissions of the
 * signed-in person (MK-015). The kernel runs it by calling the backend API of the extension.
 *
 * @param name identifier within the extension, for example {@code create-note}
 * @param title short human readable name
 * @param description what the action does, for the assistant and for the person who confirms it
 * @param risk {@code read} runs at once; {@code write} and {@code execute} produce a draft that the
 *     person confirms
 * @param input JSON Schema of the arguments
 * @param method HTTP method of the call
 * @param path path of the call, relative to the backend API of the extension; {@code {name}} is
 *     replaced by the argument of that name
 */
public record ActionEntry(
        String name, String title, String description, ActionRisk risk, InputSchema input, String method, String path) {

    public ActionEntry {
        Objects.requireNonNull(name, "name");
        Objects.requireNonNull(title, "title");
        description = Objects.requireNonNullElse(description, "");
        Objects.requireNonNull(risk, "risk");
        Objects.requireNonNull(input, "input");
        Objects.requireNonNull(method, "method");
        Objects.requireNonNull(path, "path");
    }
}
