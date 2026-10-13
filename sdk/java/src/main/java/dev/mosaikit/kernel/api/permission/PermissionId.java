// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.permission;

import dev.mosaikit.kernel.api.extension.ExtensionManifests;
import java.util.Objects;

/**
 * The qualified identifier of a permission, {@code <extension>:<permission>}, such as
 * {@code dev.example.dashboards:create-dashboard} (MK-056, ADR-0038). Inside its extension a
 * permission is named by its name alone; wherever it is named outside it (in profiles, in the answers
 * of the API of the kernel, in the audit log) it is named by this identifier.
 *
 * @param extension identifier of the extension that declares the permission
 * @param name name of the permission in the manifest, such as {@code create-dashboard}
 */
public record PermissionId(String extension, String name) {

    /** Between the extension and the name of the permission. */
    public static final char SEPARATOR = ':';

    /**
     * Checks the parts of the identifier.
     *
     * @throws IllegalArgumentException when the extension is not a reverse-DNS identifier or the name
     *     is not the name of a permission
     */
    public PermissionId {
        Objects.requireNonNull(extension, "extension");
        Objects.requireNonNull(name, "name");
        if (!ExtensionManifests.ID_PATTERN.matcher(extension).matches()) {
            throw new IllegalArgumentException("extension must be the reverse-DNS identifier of an extension");
        }
        if (!ExtensionManifests.PERMISSION_PATTERN.matcher(name).matches()) {
            throw new IllegalArgumentException(
                    "name must be lowercase letters, digits and '-', such as create-dashboard");
        }
    }

    /**
     * Reads {@code <extension>:<permission>}.
     *
     * @throws IllegalArgumentException when the text is not a qualified identifier of a permission
     */
    public static PermissionId parse(String qualified) {
        Objects.requireNonNull(qualified, "qualified");
        int separator = qualified.indexOf(SEPARATOR);
        if (separator < 0 || separator != qualified.lastIndexOf(SEPARATOR)) {
            throw new IllegalArgumentException("a permission is named as <extension>:<permission>");
        }
        return new PermissionId(qualified.substring(0, separator), qualified.substring(separator + 1));
    }

    /** As {@code <extension>:<permission>}. */
    @Override
    public String toString() {
        return extension + SEPARATOR + name;
    }
}
