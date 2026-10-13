// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.docs;

import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The table "Endpoints of the kernel" of docs/development/api.md, rewritten from the OpenAPI
 * document of the kernel: one row per path and set of methods, sorted by path, so that two pull
 * requests that add endpoints add rows in different places and do not conflict.
 *
 * <p>A row keeps the text written for it (who may call it, what it does); the methods that the
 * kernel no longer serves leave it, and a row without methods goes. An endpoint without a row gets
 * one, with the access read from the security of the operation (or its extension {@code
 * x-mosaikit-access}) and its {@code @Operation} summary, to be completed if needed. Rows of
 * endpoints that OpenAPI does not describe, such as {@code WS} ones, stay as they are.
 */
final class ApiTable {

    /** The first line of the table. */
    static final String HEADER = "| Method and path | Who | Purpose |";

    /** The HTTP methods that OpenAPI describes, in the order in which a row lists them. */
    static final List<String> METHODS = List.of("GET", "POST", "PUT", "PATCH", "DELETE");

    private static final Pattern ENDPOINT =
            Pattern.compile("^\\| `([A-Z]+(?:, [A-Z]+)*) (/[^`\\s?]*)(\\?[^`]*)?`(.*)$");

    /** An operation that the kernel serves, as its OpenAPI document describes it. */
    record Operation(String method, String path, String access, String summary) {}

    /** A row of the table: its methods, its path, and the rest of the line after the path. */
    record Row(List<String> methods, String path, String query, String rest) {

        String line() {
            return "| `" + String.join(", ", methods) + " " + path + query + "`" + rest;
        }

        boolean described() {
            return METHODS.containsAll(methods);
        }
    }

    private ApiTable() {}

    /** The index of the first and after the last line of the table in the lines of the page. */
    static int[] bounds(List<String> lines) {
        int header = lines.indexOf(HEADER);
        if (header < 0 || header + 1 >= lines.size() || !lines.get(header + 1).startsWith("|---")) {
            throw new IllegalStateException("api.md has no table starting with " + HEADER);
        }
        int end = header + 2;
        while (end < lines.size() && lines.get(end).startsWith("|")) {
            end++;
        }
        return new int[] {header + 2, end};
    }

    /** Reads a row; one row documents one path. */
    static Row row(String line) {
        Matcher matcher = ENDPOINT.matcher(line);
        if (!matcher.matches() || matcher.group(4).split(" \\| ", 2)[0].contains("`")) {
            throw new IllegalStateException(
                    "A row of the endpoints of api.md starts with one `METHOD /path` (several methods"
                            + " separated by commas, one path): " + line);
        }
        List<String> methods = List.of(matcher.group(1).split(", "));
        String query = matcher.group(3) == null ? "" : matcher.group(3);
        return new Row(methods, matcher.group(2), query, matcher.group(4));
    }

    /** The page with its table rewritten from the operations the kernel serves. */
    static String rewrite(String page, Collection<Operation> served) {
        List<String> lines = new ArrayList<>(List.of(page.split("\n", -1)));
        int[] bounds = bounds(lines);
        List<Row> rows = new ArrayList<>();
        for (String line : lines.subList(bounds[0], bounds[1])) {
            rows.add(row(line));
        }

        Map<String, Operation> byEndpoint = new TreeMap<>();
        served.forEach(operation -> byEndpoint.put(operation.method() + " " + operation.path(), operation));
        Set<String> documented = new LinkedHashSet<>();
        List<Row> kept = new ArrayList<>();
        for (Row row : rows) {
            if (!row.described()) {
                kept.add(row);
                continue;
            }
            List<String> methods = METHODS.stream()
                    .filter(row.methods()::contains)
                    .filter(method -> byEndpoint.containsKey(method + " " + row.path()))
                    .toList();
            methods.forEach(method -> documented.add(method + " " + row.path()));
            if (!methods.isEmpty()) {
                kept.add(new Row(methods, row.path(), row.query(), row.rest()));
            }
        }
        for (Operation operation : byEndpoint.values()) {
            if (!documented.contains(operation.method() + " " + operation.path())) {
                kept.add(new Row(
                        List.of(operation.method()),
                        operation.path(),
                        "",
                        " | " + cell(operation.access()) + " | " + cell(operation.summary()) + " |"));
            }
        }
        kept.sort(Comparator.comparing(Row::path, ApiTable::comparePaths)
                .thenComparing(row -> order(row.methods().getFirst())));

        List<String> result = new ArrayList<>(lines.subList(0, bounds[0]));
        kept.forEach(row -> result.add(row.line()));
        result.addAll(lines.subList(bounds[1], lines.size()));
        return String.join("\n", result);
    }

    /** Who may call an operation, from its OpenAPI security requirement. */
    static String access(List<String> roles, boolean secured) {
        if (!secured) {
            return "anyone";
        }
        if (roles.isEmpty()) {
            return "signed in";
        }
        return String.join(", ", roles.stream().map(role -> "`" + role + "`").toList());
    }

    /** Paths in the order of their segments, so that a path comes right before those under it. */
    static int comparePaths(String a, String b) {
        String[] left = a.split("/");
        String[] right = b.split("/");
        for (int i = 0; i < Math.min(left.length, right.length); i++) {
            int compared = left[i].compareTo(right[i]);
            if (compared != 0) {
                return compared;
            }
        }
        return Integer.compare(left.length, right.length);
    }

    private static int order(String method) {
        int index = METHODS.indexOf(method);
        return index < 0 ? METHODS.size() : index;
    }

    private static String cell(String text) {
        String value = text == null || text.isBlank() ? "TODO" : text.strip();
        return value.replace("|", "\\|").replace("\n", " ");
    }
}
