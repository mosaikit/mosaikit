// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.files;

import dev.mosaikit.kernel.api.resource.ResourceRef;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * A file of an extension as the kernel knows it (MK-041): its identifier, what the extension said
 * of it, and what the kernel measured when it was stored. The content is in the store of the
 * installation, read through {@link FileStorage#read}.
 *
 * @param id the identifier of the file, given by the kernel
 * @param extension the extension that stored it
 * @param name its name, or a path such as {@code tiles/3/4/2.png}
 * @param contentType its media type, such as {@code image/png}
 * @param size its size in bytes
 * @param checksum the SHA-256 of the content, in lowercase hexadecimal: also its HTTP entity tag
 * @param owner the account of the person who stored it, or {@code null} when stored without a person
 *     or after they left
 * @param team the team it is shared with, or {@code null} for a file of the whole organization
 * @param resource the registered resource it belongs to (MK-054), or {@code null}
 * @param createdAt when it was stored
 * @param updatedAt when it last changed
 */
public record StoredFile(
        UUID id,
        String extension,
        String name,
        String contentType,
        long size,
        String checksum,
        UUID owner,
        UUID team,
        ResourceRef resource,
        Instant createdAt,
        Instant updatedAt) {

    /** Checks the fields that every file has. */
    public StoredFile {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(extension, "extension");
        Objects.requireNonNull(name, "name");
        Objects.requireNonNull(contentType, "contentType");
        Objects.requireNonNull(checksum, "checksum");
        Objects.requireNonNull(createdAt, "createdAt");
        Objects.requireNonNull(updatedAt, "updatedAt");
        if (size < 0) {
            throw new IllegalArgumentException("size must not be negative");
        }
    }

    /** Whether the file is shared with one team only, rather than with the whole organization. */
    public boolean ofTeam() {
        return team != null;
    }
}
