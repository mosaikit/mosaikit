// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A part of a file, from its first to its last byte included, as a {@code Range} header asks for it
 * (RFC 9110, section 14). Only single ranges are served; a header with several ranges, or that is
 * not about bytes, is ignored and the whole file is sent, as the RFC allows.
 *
 * @param first the first byte
 * @param last the last byte, included
 */
public record ByteRange(long first, long last) {

    private static final Pattern SINGLE = Pattern.compile("^bytes=(\\d{0,40})-(\\d{0,40})$");

    /** The result of reading a {@code Range} header. */
    public sealed interface Request {}

    /** The whole file: no header, or one that is ignored. */
    public record Whole() implements Request {}

    /** A part that the file has. */
    public record Part(ByteRange range) implements Request {}

    /** A range the file does not have: answered with 416. */
    public record Unsatisfiable() implements Request {}

    public ByteRange {
        if (first < 0 || last < first) {
            throw new IllegalArgumentException("Not a range: " + first + "-" + last);
        }
    }

    /** The whole of a file of the given size, which is not empty. */
    public static ByteRange whole(long size) {
        return new ByteRange(0, size - 1);
    }

    /** How many bytes. */
    public long length() {
        return last - first + 1;
    }

    /** The value of {@code Content-Range} for a file of the given size. */
    public String contentRange(long size) {
        return "bytes " + first + "-" + last + "/" + size;
    }

    /** Reads a {@code Range} header for a file of the given size. */
    public static Request parse(String header, long size) {
        if (header == null || header.isBlank()) {
            return new Whole();
        }
        Matcher matcher = SINGLE.matcher(header.strip());
        if (!matcher.matches()) {
            return new Whole();
        }
        Optional<Long> start = number(matcher.group(1));
        Optional<Long> end = number(matcher.group(2));
        if (start.isEmpty() && end.isEmpty()) {
            return new Whole();
        }
        if (start.isEmpty()) {
            // The last n bytes.
            long suffix = end.get();
            if (suffix == 0 || size == 0) {
                return new Unsatisfiable();
            }
            return new Part(new ByteRange(Math.max(0, size - suffix), size - 1));
        }
        long first = start.get();
        if (end.isPresent() && end.get() < first) {
            return new Whole();
        }
        if (first >= size) {
            return new Unsatisfiable();
        }
        long last = end.map(value -> Math.min(value, size - 1)).orElse(size - 1);
        return new Part(new ByteRange(first, last));
    }

    private static Optional<Long> number(String digits) {
        if (digits.isEmpty()) {
            return Optional.empty();
        }
        try {
            return Optional.of(Long.parseLong(digits));
        } catch (NumberFormatException e) {
            return Optional.of(Long.MAX_VALUE);
        }
    }
}
