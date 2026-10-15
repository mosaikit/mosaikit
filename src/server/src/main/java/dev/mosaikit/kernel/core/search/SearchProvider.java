// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.search;

import java.util.Map;
import java.util.Objects;

/**
 * A provider of the global search (MK-040, ADR-0030): one pill of the search box.
 *
 * @param id {@code people} and {@code teams} for those of the kernel, {@code <extension>/<contribution>}
 *     for those of extensions
 * @param title the label of the pill, in English
 * @param i18n the label in other languages, by language tag
 * @param extension the extension that contributes it, {@code null} for the kernel
 * @param api the API of that extension, {@code /api/v1/ext/<api>/}
 * @param path where it searches, relative to that API
 * @param order its place among the pills, smaller first
 */
public record SearchProvider(
        String id, String title, Map<String, String> i18n, String extension, String api, String path, int order) {

    public SearchProvider {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(title, "title");
        i18n = Map.copyOf(i18n);
    }

    /** A provider of the kernel. */
    static SearchProvider kernel(String id, String title, int order) {
        return new SearchProvider(id, title, Map.of(), null, null, null, order);
    }

    /** Whether the kernel answers it, without calling an extension. */
    public boolean ofKernel() {
        return extension == null;
    }
}
