// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.documents;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.Instant;
import java.util.UUID;

/**
 * A document as the API returns it.
 *
 * @param team the team it is shared with, or {@code null} for the whole organization (MK-032)
 * @param version changes at every update; send it back with {@code If-Match} to avoid overwriting
 *     a newer version
 */
public record DocumentView(
        UUID id,
        UUID team,
        JsonNode data,
        int version,
        Instant createdAt,
        String createdBy,
        Instant updatedAt,
        String updatedBy) {}
