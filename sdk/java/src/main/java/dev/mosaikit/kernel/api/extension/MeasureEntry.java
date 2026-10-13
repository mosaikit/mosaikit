// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.Locale;
import java.util.Map;
import java.util.Objects;

/**
 * Something that an extension meters for each organization (MK-076), such as calls to a service or
 * credits of a model. Platform administrators set a limit for it per organization, the extension
 * asks the kernel whether an action fits before doing it, and the administrators of the organization
 * see what it used. Its identifier in the kernel is {@code <extension>/<id>}.
 *
 * @param id identifier within the extension, such as {@code renders}
 * @param label short human readable name, such as {@code Renders}
 * @param unit what it counts, such as {@code calls}, {@code credits} or {@code bytes}
 * @param kind a counter per calendar month, or a gauge of what is kept now
 * @param i18n {@code label} in other languages, by language tag (MK-053)
 */
public record MeasureEntry(String id, String label, String unit, Kind kind, Map<String, Map<String, String>> i18n) {

    /** How a measure counts. */
    public enum Kind {
        /** What is used in a calendar month (UTC), from zero at the start of each month. */
        COUNTER,
        /** What is kept now, which goes up and down. */
        GAUGE;

        /** As in the manifest: {@code counter} or {@code gauge}. */
        public String value() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    public MeasureEntry {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(label, "label");
        Objects.requireNonNull(unit, "unit");
        Objects.requireNonNull(kind, "kind");
        i18n = Translations.copy(i18n);
    }
}
