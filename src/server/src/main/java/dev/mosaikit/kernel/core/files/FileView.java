// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import java.time.Instant;
import java.util.UUID;

/**
 * A file of an extension as the API shows it (MK-041).
 *
 * @param owner the account of the person who stored it, or {@code null}
 * @param team the team it is shared with, or {@code null} for a file of the organization
 * @param checksum the SHA-256 of the content, in hexadecimal
 * @param resource the entry of the registered resource it belongs to (MK-054), or {@code null}
 */
public record FileView(
        UUID id,
        String extension,
        String name,
        String contentType,
        long size,
        String checksum,
        UUID owner,
        UUID team,
        UUID resource,
        Instant createdAt,
        Instant updatedAt) {

    static FileView of(StoredFile file) {
        return new FileView(
                file.getId(),
                file.getExtensionId(),
                file.getName(),
                file.getContentType(),
                file.getSize(),
                file.getChecksum(),
                file.getOwnerId(),
                file.getTeamId(),
                file.getResourceId(),
                file.getCreatedAt(),
                file.getUpdatedAt());
    }

    /** The strong entity tag of the content, quoted, for {@code ETag} and {@code If-None-Match}. */
    public String etag() {
        return "\"" + checksum + "\"";
    }
}
