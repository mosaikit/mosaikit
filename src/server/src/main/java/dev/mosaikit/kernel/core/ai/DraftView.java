// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.UUID;

/**
 * A draft as returned by the API: enough for the person to decide what they confirm.
 *
 * @param id identifier to confirm or reject it with
 * @param tool name of the tool
 * @param title title of the tool, or its name when no active plugin offers it any more
 * @param description what the tool does
 * @param risk {@code write} or {@code execute}; absent when no active plugin offers the tool
 * @param input the arguments
 * @param status {@code pending}, {@code executed}, {@code failed}, {@code rejected} or {@code
 *     expired}
 * @param createdAt when the assistant proposed it
 * @param expiresAt until when the person can confirm it
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record DraftView(
        UUID id,
        String tool,
        String title,
        String description,
        String risk,
        Object input,
        String status,
        Instant createdAt,
        Instant expiresAt) {}
