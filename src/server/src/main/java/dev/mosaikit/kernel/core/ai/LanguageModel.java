// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Optional;

/** A language model with tool calling, behind a chat completions API (MK-024). */
public interface LanguageModel {

    /** The model, when one is configured. */
    Optional<String> model();

    /**
     * Sends a chat completions request: {@code messages} and {@code tools} in the OpenAI format.
     *
     * @return the message of the first choice
     * @throws java.io.UncheckedIOException when the model cannot be reached or answers an error
     */
    JsonNode complete(ObjectNode request);
}
