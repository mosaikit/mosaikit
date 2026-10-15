// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.search;

import com.fasterxml.jackson.annotation.JsonInclude;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import java.util.List;
import java.util.Objects;

/**
 * A result of the global search (MK-040).
 *
 * @param title what the result is called
 * @param detail one line under the title, such as the email address of a person
 * @param link where the shell opens it, a path of the shell such as {@code /app/files?file=…};
 *     {@code null} when it opens nowhere
 * @param resource the resource of an extension it stands for, which the kernel checked the person may
 *     read (MK-135); {@code null} otherwise
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SearchHit(String title, String detail, String link, ResourceRef resource) {

    public SearchHit {
        Objects.requireNonNull(title, "title");
    }

    /**
     * One page of the results of a provider.
     *
     * @param hits the results of the page
     * @param more whether there are results after the page
     */
    public record Page(List<SearchHit> hits, boolean more) {

        public Page {
            hits = List.copyOf(hits);
        }

        /** The page of a list with one element more than the page, when there are more. */
        static Page of(List<SearchHit> oneMore, int limit) {
            return oneMore.size() > limit ? new Page(oneMore.subList(0, limit), true) : new Page(oneMore, false);
        }
    }
}
