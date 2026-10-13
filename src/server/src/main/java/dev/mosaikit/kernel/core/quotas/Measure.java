// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.quotas;

import java.util.Locale;

/**
 * Something that organizations consume and that may have a limit (MK-076): the storage of the
 * kernel, or a measure that an extension declares in its manifest, such as calls to a service or
 * credits of a model.
 *
 * @param id {@code storage}, or {@code <extension>/<measure>} for a measure of an extension
 * @param label what people read, such as {@code Renders}
 * @param unit what it counts, such as {@code bytes}, {@code calls} or {@code credits}
 * @param kind a counter per month or a gauge
 * @param extension the extension that declares it, or {@code null} for a measure of the kernel
 */
public record Measure(String id, String label, String unit, Kind kind, String extension) {

    /** The bytes that an organization keeps: its files and the space its extensions report. */
    public static final String STORAGE_ID = "storage";

    /** The unit of storage, which the messages show as KB, MB, GB, of 1024 as in the settings. */
    public static final String BYTES = "bytes";

    /** The storage of the kernel, a gauge in bytes. */
    public static final Measure STORAGE = new Measure(STORAGE_ID, "Storage", BYTES, Kind.GAUGE, null);

    /** How a measure counts. */
    public enum Kind {
        /** What is used in a calendar month (UTC), from zero at the start of each month. */
        COUNTER,
        /** What is kept now, which goes up and down. */
        GAUGE;

        /** As in manifests and the API: {@code counter} or {@code gauge}. */
        public String value() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    /** The identifier of a measure that an extension declares. */
    public static String of(String extension, String measure) {
        return extension + "/" + measure;
    }

    /** An amount in the unit of the measure, such as {@code 1.5 MB} or {@code 1000 renders}. */
    public String format(long amount) {
        return BYTES.equals(unit) ? bytes(amount) : amount + " " + unit;
    }

    /** Bytes in units of 1024, as {@code mosaikit.quotas.storage} reads {@code 10G}. */
    static String bytes(long amount) {
        String[] units = {"bytes", "KB", "MB", "GB", "TB", "PB", "EB"};
        if (Math.abs(amount) < 1024) {
            return amount + " bytes";
        }
        double value = amount;
        int unit = 0;
        while (Math.abs(value) >= 1024 && unit < units.length - 1) {
            value /= 1024;
            unit++;
        }
        String number = String.format(Locale.ROOT, "%.1f", value);
        if (number.endsWith(".0")) {
            number = number.substring(0, number.length() - 2);
        }
        return number + " " + units[unit];
    }
}
