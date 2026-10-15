// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.search;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * The text that a person searches (MK-040), and the same text as a PostgreSQL {@code tsquery} where
 * every word is a prefix: {@code ada ross} becomes {@code ada:* & ross:*}, so that a result appears
 * while the person is still typing. The query keeps only letters and digits, so it can be passed to
 * {@code to_tsquery} as a bound parameter without a syntax error.
 *
 * @param text the text, trimmed
 * @param tsquery the words as prefixes, joined by {@code &}
 */
public record SearchText(String text, String tsquery) {

    /** The longest text searched. */
    public static final int MAX_LENGTH = 200;

    /** The most words of a query. */
    static final int MAX_WORDS = 8;

    private static final Pattern NOT_WORD = Pattern.compile("[^\\p{L}\\p{N}]+");

    /** The text of a search, empty when it has no word to search. */
    public static Optional<SearchText> of(String text) {
        if (text == null) {
            return Optional.empty();
        }
        String trimmed = text.strip();
        if (trimmed.length() > MAX_LENGTH) {
            trimmed = trimmed.substring(0, MAX_LENGTH);
        }
        List<String> words = new ArrayList<>();
        for (String word : NOT_WORD.split(trimmed.toLowerCase(Locale.ROOT))) {
            if (!word.isEmpty() && words.size() < MAX_WORDS) {
                words.add(word + ":*");
            }
        }
        if (words.isEmpty()) {
            return Optional.empty();
        }
        return Optional.of(new SearchText(trimmed, String.join(" & ", words)));
    }
}
