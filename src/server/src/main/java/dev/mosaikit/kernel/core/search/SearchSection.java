// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.search;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * The results of one provider in an answer of the global search (MK-040).
 *
 * @param provider the identifier of the provider
 * @param title the label of its pill, in English
 * @param results the results of the page asked for
 * @param more whether it has more results after them
 * @param status {@code complete}, or {@code incomplete} when the provider did not answer in time or
 *     failed: its results are then missing, and the other providers are shown anyway
 * @param reason why it is incomplete: {@code timeout} or {@code failed}
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SearchSection(
        String provider, String title, List<SearchHit> results, boolean more, String status, String reason) {

    public static final String COMPLETE = "complete";
    public static final String INCOMPLETE = "incomplete";
    public static final String TIMEOUT = "timeout";
    public static final String FAILED = "failed";

    public SearchSection {
        results = List.copyOf(results);
    }

    static SearchSection complete(SearchProvider provider, SearchHit.Page page) {
        return new SearchSection(provider.id(), provider.title(), page.hits(), page.more(), COMPLETE, null);
    }

    static SearchSection incomplete(SearchProvider provider, String reason) {
        return new SearchSection(provider.id(), provider.title(), List.of(), false, INCOMPLETE, reason);
    }

    /**
     * An answer of the global search.
     *
     * @param query the text searched
     * @param sections one per provider asked, in the order of the pills
     */
    public record Answer(String query, List<SearchSection> sections) {

        public Answer {
            sections = List.copyOf(sections);
        }
    }
}
