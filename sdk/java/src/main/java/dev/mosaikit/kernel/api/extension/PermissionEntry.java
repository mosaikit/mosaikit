// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.Map;
import java.util.Objects;

/**
 * A permission that an extension declares (MK-056, ADR-0038), such as "create a dashboard". The
 * administrators of an organization see it in the profile editor under the name of the extension; it
 * is off until they grant it, also when an update of the extension adds it.
 *
 * @param name identifier within the extension, such as {@code create-dashboard}
 * @param title short human readable name, shown in the profile editor
 * @param description what the permission allows, possibly empty
 * @param i18n {@code title} and {@code description} in other languages, by language tag (MK-053)
 */
public record PermissionEntry(String name, String title, String description, Map<String, Map<String, String>> i18n) {

    public PermissionEntry {
        Objects.requireNonNull(name, "name");
        Objects.requireNonNull(title, "title");
        description = Objects.requireNonNullElse(description, "");
        i18n = Translations.copy(i18n);
    }
}
