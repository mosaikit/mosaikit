// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.version;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * A set of accepted versions, written with the npm-like syntax used in extension manifests.
 *
 * <p>Supported forms:
 *
 * <ul>
 *   <li>comparators: {@code =1.2.3}, {@code >1.2}, {@code >=1.4}, {@code <2}, {@code <=2.1};
 *   <li>caret: {@code ^1.2.3} allows changes that do not modify the left-most non-zero number;
 *   <li>tilde: {@code ~1.2.3} allows patch-level changes;
 *   <li>partial versions: {@code 1.2} means {@code >=1.2.0 <1.3.0};
 *   <li>wildcard: {@code *} or an empty string accepts every normal version;
 *   <li>intersection with spaces ({@code >=1.4 <2}) and union with {@code ||}.
 * </ul>
 *
 * <p>A pre-release version satisfies a range only if one comparator of the matching set targets a
 * pre-release of the same {@code major.minor.patch}, so that {@code ^1.0} never selects {@code
 * 2.0.0-rc.1}.
 */
public final class VersionRange {

    private static final Pattern PART = Pattern.compile("\\d+|[xX*]");
    private static final Pattern BUILD = Pattern.compile("[0-9A-Za-z-.]+");

    private final String text;
    private final List<List<Comparator>> sets;

    private VersionRange(String text, List<List<Comparator>> sets) {
        this.text = text;
        this.sets = sets;
    }

    /** A range that accepts every normal version. */
    public static VersionRange any() {
        return parse("*");
    }

    /**
     * Parses a range expression.
     *
     * @throws InvalidVersionException if the expression is not valid
     */
    public static VersionRange parse(String text) {
        Objects.requireNonNull(text, "text");
        List<List<Comparator>> sets = Arrays.stream(text.split("\\|\\|", -1))
                .map(alternative -> parseSet(alternative.trim(), text))
                .toList();
        return new VersionRange(text.trim(), sets);
    }

    /** Returns {@code true} if the given version belongs to this range. */
    public boolean contains(Version version) {
        Objects.requireNonNull(version, "version");
        return sets.stream().anyMatch(set -> satisfies(set, version));
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof VersionRange range && text.equals(range.text);
    }

    @Override
    public int hashCode() {
        return text.hashCode();
    }

    @Override
    public String toString() {
        return text;
    }

    private static boolean satisfies(List<Comparator> set, Version version) {
        if (!set.stream().allMatch(comparator -> comparator.test(version))) {
            return false;
        }
        if (!version.isPreRelease()) {
            return true;
        }
        return set.stream()
                .map(Comparator::version)
                .anyMatch(bound -> bound.isPreRelease() && bound.core().equals(version.core()));
    }

    private static List<Comparator> parseSet(String set, String source) {
        if (set.isEmpty() || set.equals("*") || set.equalsIgnoreCase("x")) {
            return List.of(new Comparator(Operator.GE, Version.of(0, 0, 0)));
        }
        var comparators = new ArrayList<Comparator>();
        for (String token : normalize(set).split("\\s+")) {
            comparators.addAll(parseToken(token, source));
        }
        return List.copyOf(comparators);
    }

    /** Joins operators separated from their version by spaces, for example {@code ">= 1.2"}. */
    private static String normalize(String set) {
        return set.replaceAll("(>=|<=|>|<|=|\\^|~)\\s+", "$1");
    }

    private static List<Comparator> parseToken(String token, String source) {
        String operator = token.replaceAll("^(>=|<=|>|<|=|\\^|~)?.*$", "$1");
        Partial partial = Partial.parse(token.substring(operator.length()), source);
        return switch (operator) {
            case "^" -> caret(partial);
            case "~" -> tilde(partial);
            case ">=" -> List.of(new Comparator(Operator.GE, partial.floor()));
            case ">" ->
                List.of(
                        partial.isComplete()
                                ? new Comparator(Operator.GT, partial.floor())
                                : new Comparator(Operator.GE, partial.nextAfterMissing()));
            case "<" ->
                List.of(new Comparator(Operator.LT, partial.isComplete() ? partial.floor() : lowest(partial.floor())));
            case "<=" ->
                List.of(
                        partial.isComplete()
                                ? new Comparator(Operator.LE, partial.floor())
                                : new Comparator(Operator.LT, lowest(partial.nextAfterMissing())));
            default -> exact(partial);
        };
    }

    private static List<Comparator> exact(Partial partial) {
        if (partial.isComplete()) {
            return List.of(new Comparator(Operator.EQ, partial.floor()));
        }
        return between(partial.floor(), partial.nextAfterMissing());
    }

    private static List<Comparator> caret(Partial partial) {
        Version floor = partial.floor();
        Version ceiling;
        if (floor.major() > 0 || partial.minor() == null) {
            ceiling = Version.of(floor.major() + 1, 0, 0);
        } else if (floor.minor() > 0 || partial.patch() == null) {
            ceiling = Version.of(0, floor.minor() + 1, 0);
        } else {
            ceiling = Version.of(0, 0, floor.patch() + 1);
        }
        return between(floor, ceiling);
    }

    private static List<Comparator> tilde(Partial partial) {
        Version floor = partial.floor();
        Version ceiling = partial.minor() == null
                ? Version.of(floor.major() + 1, 0, 0)
                : Version.of(floor.major(), floor.minor() + 1, 0);
        return between(floor, ceiling);
    }

    private static List<Comparator> between(Version floor, Version exclusiveCeiling) {
        return List.of(new Comparator(Operator.GE, floor), new Comparator(Operator.LT, lowest(exclusiveCeiling)));
    }

    /** The lowest pre-release of a version, used as an exclusive upper bound. */
    private static Version lowest(Version version) {
        return new Version(version.major(), version.minor(), version.patch(), List.of("0"), List.of());
    }

    private enum Operator {
        EQ,
        GT,
        GE,
        LT,
        LE
    }

    private record Comparator(Operator operator, Version version) {

        boolean test(Version candidate) {
            int result = candidate.compareTo(version);
            return switch (operator) {
                case EQ -> result == 0;
                case GT -> result > 0;
                case GE -> result >= 0;
                case LT -> result < 0;
                case LE -> result <= 0;
            };
        }
    }

    /** A version where minor and patch may be missing or wildcards. */
    private record Partial(int major, Integer minor, Integer patch, List<String> preRelease) {

        static Partial parse(String text, String source) {
            var parts = SemanticVersionText.split(text);
            String[] numbers = parts.core().split("\\.", -1);
            boolean valid = numbers.length <= 3
                    && Arrays.stream(numbers).allMatch(n -> PART.matcher(n).matches())
                    && !isWildcard(numbers[0])
                    && parts.hasValidPreRelease()
                    && (parts.build() == null || BUILD.matcher(parts.build()).matches());
            if (!valid) {
                throw new InvalidVersionException("Invalid version range: '" + source + "'");
            }
            Integer minor = numbers.length > 1 ? number(numbers[1]) : null;
            Integer patch = minor == null || numbers.length < 3 ? null : number(numbers[2]);
            List<String> preRelease = parts.preRelease() == null || patch == null
                    ? List.of()
                    : List.of(parts.preRelease().split("\\."));
            return new Partial(Integer.parseInt(numbers[0]), minor, patch, preRelease);
        }

        boolean isComplete() {
            return minor != null && patch != null;
        }

        Version floor() {
            return new Version(major, minor == null ? 0 : minor, patch == null ? 0 : patch, preRelease, List.of());
        }

        /** The first version after the range described by the missing parts. */
        Version nextAfterMissing() {
            if (minor == null) {
                return Version.of(major + 1, 0, 0);
            }
            if (patch == null) {
                return Version.of(major, minor + 1, 0);
            }
            return Version.of(major, minor, patch + 1);
        }

        private static Integer number(String group) {
            return group == null || isWildcard(group) ? null : Integer.valueOf(group);
        }

        private static boolean isWildcard(String group) {
            return group.equals("*") || group.equalsIgnoreCase("x");
        }
    }
}
