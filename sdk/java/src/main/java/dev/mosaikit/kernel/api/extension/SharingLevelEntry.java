// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.Map;
import java.util.Objects;

/**
 * A level at which a resource type is shared (MK-055), such as {@code view} or {@code edit}.
 *
 * @param name identifier within the type, such as {@code edit}
 * @param title short human readable name, shown in the sharing dialog
 * @param i18n {@code title} in other languages, by language tag (MK-053)
 */
public record SharingLevelEntry(String name, String title, Map<String, Map<String, String>> i18n) {

    public SharingLevelEntry {
        Objects.requireNonNull(name, "name");
        Objects.requireNonNull(title, "title");
        i18n = Translations.copy(i18n);
    }
}
