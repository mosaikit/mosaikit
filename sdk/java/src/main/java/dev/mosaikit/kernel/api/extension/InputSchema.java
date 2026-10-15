// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.BiConsumer;
import java.util.regex.Pattern;

/**
 * The JSON Schema of the input of an action (MK-015), and of the payload of the contributions to an
 * extension point (MK-134), limited to the keywords that describe plain
 * data: {@code type}, {@code properties}, {@code required}, {@code additionalProperties} (true or
 * false), {@code items}, {@code enum}, {@code minLength}, {@code maxLength}, {@code minimum},
 * {@code maximum}, {@code minItems}, {@code maxItems}, {@code format}, and the annotations {@code
 * title}, {@code description}, {@code default} and {@code examples}. Other keywords are refused in
 * the manifest, so that a schema never promises a check that is not made.
 *
 * <p>The formats {@code uuid}, {@code date}, {@code date-time} and {@code email} of a string are
 * checked, so that an assistant that passes a title where an identifier is expected is told at once,
 * instead of drafting an action that fails when it is confirmed; other formats stay annotations.
 */
public final class InputSchema {

    private static final String TYPE = "type";
    private static final String OBJECT = "object";
    private static final String ARRAY = "array";
    private static final String INTEGER = "integer";
    private static final String PROPERTIES = "properties";
    private static final String REQUIRED = "required";
    private static final String ADDITIONAL_PROPERTIES = "additionalProperties";
    private static final String ITEMS = "items";
    private static final String ENUM = "enum";
    private static final String MIN_LENGTH = "minLength";
    private static final String MAX_LENGTH = "maxLength";
    private static final String MINIMUM = "minimum";
    private static final String MAXIMUM = "maximum";
    private static final String MIN_ITEMS = "minItems";
    private static final String MAX_ITEMS = "maxItems";
    private static final String FORMAT = "format";
    private static final Pattern UUID =
            Pattern.compile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$");
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");

    private static final Set<String> TYPES = Set.of(OBJECT, ARRAY, "string", INTEGER, "number", "boolean", "null");
    private static final Set<String> KEYWORDS = Set.of(
            TYPE,
            PROPERTIES,
            REQUIRED,
            ADDITIONAL_PROPERTIES,
            ITEMS,
            ENUM,
            MIN_LENGTH,
            MAX_LENGTH,
            MINIMUM,
            MAXIMUM,
            MIN_ITEMS,
            MAX_ITEMS,
            "title",
            "description",
            "default",
            FORMAT,
            "examples",
            "$schema");
    private static final List<String> BOUNDS = List.of(MIN_LENGTH, MAX_LENGTH, MIN_ITEMS, MAX_ITEMS, MINIMUM, MAXIMUM);
    private static final Set<String> AN_TYPES = Set.of(INTEGER, ARRAY, OBJECT);

    private final Map<String, Object> tree;

    private InputSchema(Map<String, Object> tree) {
        this.tree = tree;
    }

    /**
     * Reads a schema from a manifest; problems are reported to {@code violation} with the path of
     * the keyword.
     *
     * @return the schema, or {@code null} when it has problems
     */
    public static InputSchema parse(Object raw, String field, BiConsumer<String, String> violation) {
        int[] problems = {0};
        checkSchema(
                raw,
                field,
                (path, message) -> {
                    problems[0]++;
                    violation.accept(path, message);
                },
                true);
        if (problems[0] > 0) {
            return null;
        }
        @SuppressWarnings("unchecked")
        Map<String, Object> map = (Map<String, Object>) copy(raw);
        return new InputSchema(map);
    }

    /** The schema as a tree of maps and lists, to publish it as JSON. */
    public Map<String, Object> tree() {
        return tree;
    }

    /** Checks a value against the schema; returns the problems, empty when the value is valid. */
    public List<String> validate(Object value) {
        return validate(value, "input");
    }

    /**
     * Checks a value against the schema, naming it {@code path} in the problems, such as the
     * identifier of a contribution to an extension point (MK-134).
     */
    public List<String> validate(Object value, String path) {
        List<String> problems = new ArrayList<>();
        check(tree, value, path, problems);
        return problems;
    }

    // --- checking the schema ----------------------------------------------------------------

    private static void checkSchema(Object raw, String field, BiConsumer<String, String> violation, boolean root) {
        if (!(raw instanceof Map<?, ?> schema)) {
            violation.accept(field, "must be a JSON Schema object");
            return;
        }
        for (Object key : schema.keySet()) {
            if (!KEYWORDS.contains(String.valueOf(key))) {
                violation.accept(field + "." + key, "is not a supported JSON Schema keyword");
            }
        }
        checkType(schema.get(TYPE), field, violation, root);
        checkChildren(schema, field, violation);
        requireKind(schema, REQUIRED, List.class, field, "must be a list of property names", violation);
        requireKind(schema, ADDITIONAL_PROPERTIES, Boolean.class, field, "must be true or false", violation);
        requireKind(schema, ENUM, List.class, field, "must be a list", violation);
        requireKind(schema, FORMAT, String.class, field, "must be a string", violation);
        for (String bound : BOUNDS) {
            requireKind(schema, bound, Number.class, field, "must be a number", violation);
        }
    }

    private static void checkType(Object type, String field, BiConsumer<String, String> violation, boolean root) {
        if (root && !OBJECT.equals(type)) {
            violation.accept(field + ".type", "must be 'object', with named properties");
        }
        if (type != null && !(type instanceof String name && TYPES.contains(name))) {
            violation.accept(field + ".type", "must be one of " + TYPES);
        }
    }

    private static void checkChildren(Map<?, ?> schema, String field, BiConsumer<String, String> violation) {
        if (schema.get(PROPERTIES) instanceof Map<?, ?> properties) {
            properties.forEach(
                    (name, property) -> checkSchema(property, field + ".properties." + name, violation, false));
        } else if (schema.containsKey(PROPERTIES)) {
            violation.accept(field + ".properties", "must be an object");
        }
        if (schema.containsKey(ITEMS)) {
            checkSchema(schema.get(ITEMS), field + ".items", violation, false);
        }
    }

    private static void requireKind(
            Map<?, ?> schema,
            String keyword,
            Class<?> kind,
            String field,
            String message,
            BiConsumer<String, String> violation) {
        if (schema.containsKey(keyword) && !kind.isInstance(schema.get(keyword))) {
            violation.accept(field + "." + keyword, message);
        }
    }

    private static Object copy(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> copy = new LinkedHashMap<>();
            map.forEach((key, entry) -> copy.put(String.valueOf(key), copy(entry)));
            return Collections.unmodifiableMap(copy);
        }
        if (value instanceof List<?> list) {
            return list.stream().map(InputSchema::copy).toList();
        }
        return value;
    }

    // --- checking a value -------------------------------------------------------------------

    private static void check(Map<?, ?> schema, Object value, String path, List<String> problems) {
        Object type = schema.get(TYPE);
        if (type != null && !hasType(value, (String) type)) {
            problems.add(path + " must be " + (AN_TYPES.contains(type) ? "an " : "a ") + type);
            return;
        }
        if (schema.get(ENUM) instanceof List<?> allowed && !allowed.contains(value)) {
            problems.add(path + " must be one of " + allowed);
        }
        switch (value) {
            case String text -> {
                bound(schema, MIN_LENGTH, text.length(), path, "characters", problems, true);
                bound(schema, MAX_LENGTH, text.length(), path, "characters", problems, false);
                if (schema.get(FORMAT) instanceof String format && !hasFormat(text, format)) {
                    problems.add(path + " must be a valid " + format);
                }
            }
            case Boolean _ -> {
                // Nothing more to check.
            }
            case Number number -> checkNumber(schema, number, path, problems);
            case List<?> list -> checkList(schema, list, path, problems);
            case Map<?, ?> object -> checkObject(schema, object, path, problems);
            case null, default -> {
                // Nothing more to check.
            }
        }
    }

    private static void checkNumber(Map<?, ?> schema, Number number, String path, List<String> problems) {
        BigDecimal decimal = new BigDecimal(number.toString());
        if (schema.get(MINIMUM) instanceof Number minimum
                && decimal.compareTo(new BigDecimal(minimum.toString())) < 0) {
            problems.add(path + " must be at least " + minimum);
        }
        if (schema.get(MAXIMUM) instanceof Number maximum
                && decimal.compareTo(new BigDecimal(maximum.toString())) > 0) {
            problems.add(path + " must be at most " + maximum);
        }
    }

    private static void checkList(Map<?, ?> schema, List<?> list, String path, List<String> problems) {
        bound(schema, MIN_ITEMS, list.size(), path, ITEMS, problems, true);
        bound(schema, MAX_ITEMS, list.size(), path, ITEMS, problems, false);
        if (schema.get(ITEMS) instanceof Map<?, ?> items) {
            for (int i = 0; i < list.size(); i++) {
                check(items, list.get(i), path + "[" + i + "]", problems);
            }
        }
    }

    private static void checkObject(Map<?, ?> schema, Map<?, ?> object, String path, List<String> problems) {
        Map<?, ?> properties = schema.get(PROPERTIES) instanceof Map<?, ?> map ? map : Map.of();
        if (schema.get(REQUIRED) instanceof List<?> required) {
            for (Object name : required) {
                if (!object.containsKey(name)) {
                    problems.add(path + "." + name + " is required");
                }
            }
        }
        for (var entry : object.entrySet()) {
            String name = String.valueOf(entry.getKey());
            if (properties.get(name) instanceof Map<?, ?> property) {
                check(property, entry.getValue(), path + "." + name, problems);
            } else if (Boolean.FALSE.equals(schema.get(ADDITIONAL_PROPERTIES))) {
                problems.add(path + "." + name + " is not expected");
            }
        }
    }

    private static void bound(
            Map<?, ?> schema,
            String keyword,
            int actual,
            String path,
            String unit,
            List<String> problems,
            boolean min) {
        if (schema.get(keyword) instanceof Number limit) {
            boolean broken = min ? actual < limit.intValue() : actual > limit.intValue();
            if (broken) {
                problems.add(path + " must have " + (min ? "at least " : "at most ") + limit.intValue() + " " + unit);
            }
        }
    }

    /** Whether a string has a checked format; formats that are not checked always match. */
    static boolean hasFormat(String text, String format) {
        return switch (format) {
            case "uuid" -> UUID.matcher(text).matches();
            case "email" -> EMAIL.matcher(text).matches();
            case "date" -> parses(() -> LocalDate.parse(text));
            case "date-time" -> parses(() -> OffsetDateTime.parse(text));
            default -> true;
        };
    }

    private static boolean parses(Runnable parse) {
        try {
            parse.run();
            return true;
        } catch (DateTimeParseException e) {
            return false;
        }
    }

    private static boolean hasType(Object value, String type) {
        return switch (type) {
            case OBJECT -> value instanceof Map<?, ?>;
            case ARRAY -> value instanceof List<?>;
            case "string" -> value instanceof String;
            case "boolean" -> value instanceof Boolean;
            case "null" -> value == null;
            case INTEGER -> isInteger(value);
            default -> value instanceof Number && !(value instanceof Boolean);
        };
    }

    private static boolean isInteger(Object value) {
        return switch (value) {
            case Integer _, Long _, Short _, BigInteger _ -> true;
            case Number number ->
                new BigDecimal(number.toString()).stripTrailingZeros().scale() <= 0;
            case null, default -> false;
        };
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof InputSchema schema && tree.equals(schema.tree);
    }

    @Override
    public int hashCode() {
        return Objects.hash(tree);
    }
}
