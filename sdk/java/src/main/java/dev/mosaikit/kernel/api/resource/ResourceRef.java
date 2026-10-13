// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.resource;

import dev.mosaikit.kernel.api.extension.ExtensionManifests;
import java.util.Objects;

/**
 * Names one resource of an extension (MK-054): the extension that owns it, a type the extension
 * declares in {@code resources} of its manifest, and the identifier the extension gave it.
 *
 * <p>The reference is all the kernel keeps of the identity of a resource: the data stay in the
 * extension, which chooses the identifier (a UUID, a key of its table) and never reuses it for
 * another resource of the same type.
 *
 * @param extension identifier of the extension, such as {@code dev.example.dashboards}
 * @param type a resource type declared by the extension, such as {@code dashboard}
 * @param id identifier of the resource within the type, at most {@value #MAX_ID} characters
 */
public record ResourceRef(String extension, String type, String id) {

    /** The longest identifier of a resource. */
    public static final int MAX_ID = 200;

    /**
     * Checks the parts of the reference.
     *
     * @throws IllegalArgumentException when the extension is not a reverse-DNS identifier, the type
     *     is not a resource type name or the identifier is blank or too long
     */
    public ResourceRef {
        Objects.requireNonNull(extension, "extension");
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(id, "id");
        if (!ExtensionManifests.ID_PATTERN.matcher(extension).matches()) {
            throw new IllegalArgumentException("extension must be the reverse-DNS identifier of an extension");
        }
        if (!ExtensionManifests.RESOURCE_TYPE_PATTERN.matcher(type).matches()) {
            throw new IllegalArgumentException("type must be lowercase letters, digits and '-', such as dashboard");
        }
        if (id.isBlank() || id.length() > MAX_ID) {
            throw new IllegalArgumentException("id must have 1 to " + MAX_ID + " characters");
        }
    }

    /** As {@code <extension>/<type>/<id>}, the form used in the audit log and in error messages. */
    @Override
    public String toString() {
        return extension + "/" + type + "/" + id;
    }
}
