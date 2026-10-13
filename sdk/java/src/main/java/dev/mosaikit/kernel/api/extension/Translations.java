// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.LinkedHashMap;
import java.util.Map;

/** The texts of a manifest entry in other languages (MK-053): attribute to text, by language tag. */
final class Translations {

    private Translations() {}

    /** An immutable copy; {@code null} is no translation. */
    static Map<String, Map<String, String>> copy(Map<String, Map<String, String>> i18n) {
        if (i18n == null) {
            return Map.of();
        }
        Map<String, Map<String, String>> copy = new LinkedHashMap<>();
        i18n.forEach((language, texts) -> copy.put(language, Map.copyOf(texts)));
        return Map.copyOf(copy);
    }
}
