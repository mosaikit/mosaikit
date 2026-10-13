// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("MK-015")
class InputSchemaTest {

    private static final Map<String, Object> NOTE = Map.of(
            "type",
            "object",
            "properties",
            Map.of(
                    "text", Map.of("type", "string", "minLength", 1, "maxLength", 5),
                    "priority", Map.of("type", "integer", "minimum", 1, "maximum", 3),
                    "weight", Map.of("type", "number", "minimum", 0.5),
                    "urgent", Map.of("type", "boolean"),
                    "color", Map.of("enum", List.of("red", "blue")),
                    "tags", Map.of("type", "array", "items", Map.of("type", "string"), "minItems", 1, "maxItems", 2),
                    "note", Map.of("type", "null")),
            "required",
            List.of("text"),
            "additionalProperties",
            false);

    private static InputSchema schema(Object tree) {
        List<String> problems = new ArrayList<>();
        InputSchema schema = InputSchema.parse(tree, "input", (field, message) -> problems.add(field + " " + message));
        assertThat(problems).isEmpty();
        return schema;
    }

    private static Map<String, Object> input(Object... pairs) {
        Map<String, Object> map = new LinkedHashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            map.put((String) pairs[i], pairs[i + 1]);
        }
        return map;
    }

    @Test
    void acceptsValidInput() {
        InputSchema schema = schema(NOTE);

        assertThat(schema.validate(input("text", "hi"))).isEmpty();
        assertThat(schema.validate(input(
                        "text",
                        "hello",
                        "priority",
                        3,
                        "weight",
                        2.5,
                        "urgent",
                        true,
                        "color",
                        "red",
                        "tags",
                        List.of("a"),
                        "note",
                        null)))
                .isEmpty();
        assertThat(schema.validate(input("text", "hi", "priority", 2.0))).isEmpty();
        assertThat(schema.tree()).containsEntry("type", "object");
        assertThat(schema)
                .isEqualTo(schema(NOTE))
                .hasSameHashCodeAs(schema(NOTE))
                .isNotEqualTo("schema");
    }

    @Test
    void checksTheFormatsOfStrings() {
        InputSchema schema = schema(Map.of(
                "type",
                "object",
                "properties",
                Map.of(
                        "id", Map.of("type", "string", "format", "uuid"),
                        "day", Map.of("type", "string", "format", "date"),
                        "at", Map.of("type", "string", "format", "date-time"),
                        "mail", Map.of("type", "string", "format", "email"),
                        "colour", Map.of("type", "string", "format", "hex-colour"))));

        assertThat(schema.validate(input(
                        "id", "43e1ce31-06c5-4af3-99b4-422c903595c5",
                        "day", "2026-10-01",
                        "at", "2026-10-01T16:05:03Z",
                        "mail", "mario.rossi@comune.test",
                        "colour", "anything, not checked")))
                .isEmpty();
        // An assistant that passes the title of an activity where its id is expected.
        assertThat(schema.validate(input(
                        "id", "Riparare il lampione 3491",
                        "day", "1 ottobre",
                        "at", "2026-10-01",
                        "mail", "mario.rossi")))
                .containsExactlyInAnyOrder(
                        "input.id must be a valid uuid",
                        "input.day must be a valid date",
                        "input.at must be a valid date-time",
                        "input.mail must be a valid email");
    }

    @Test
    void refusesAFormatThatIsNotAString() {
        List<String> problems = new ArrayList<>();
        InputSchema.parse(
                Map.of("type", "object", "properties", Map.of("id", Map.of("type", "string", "format", 1))),
                "input",
                (field, message) -> problems.add(field + " " + message));
        assertThat(problems).containsExactly("input.properties.id.format must be a string");
    }

    @Test
    void reportsEveryProblemOfAnInput() {
        InputSchema schema = schema(NOTE);

        assertThat(schema.validate(input(
                        "text",
                        "too long",
                        "priority",
                        7,
                        "weight",
                        0.1,
                        "urgent",
                        "yes",
                        "color",
                        "green",
                        "tags",
                        List.of(1, "b", "c"),
                        "other",
                        1)))
                .containsExactlyInAnyOrder(
                        "input.text must have at most 5 characters",
                        "input.priority must be at most 3",
                        "input.weight must be at least 0.5",
                        "input.urgent must be a boolean",
                        "input.color must be one of [red, blue]",
                        "input.tags must have at most 2 items",
                        "input.tags[0] must be a string",
                        "input.other is not expected");
        assertThat(schema.validate(input("priority", 0, "tags", List.of(), "text", "")))
                .containsExactlyInAnyOrder(
                        "input.priority must be at least 1",
                        "input.tags must have at least 1 items",
                        "input.text must have at least 1 characters");
        assertThat(schema.validate(input("text", "hi", "priority", 1.5)))
                .containsExactly("input.priority must be an integer");
        assertThat(schema.validate(input("note", 1))).contains("input.text is required", "input.note must be a null");
        assertThat(schema.validate("text")).containsExactly("input must be an object");
    }

    @Test
    void refusesSchemasItCannotCheck() {
        List<String> problems = new ArrayList<>();
        InputSchema schema = InputSchema.parse(
                Map.of(
                        "type", "string",
                        "oneOf", List.of(),
                        "properties", Map.of("a", Map.of("type", "date"), "b", "text", "c", Map.of("$ref", "#/x")),
                        "required", "a",
                        "additionalProperties", Map.of(),
                        "items", "x",
                        "enum", "a",
                        "maxLength", "5"),
                "input",
                (field, message) -> problems.add(field));

        assertThat(schema).isNull();
        assertThat(problems)
                .contains(
                        "input.oneOf",
                        "input.type",
                        "input.properties.a.type",
                        "input.properties.b",
                        "input.properties.c.$ref",
                        "input.required",
                        "input.additionalProperties",
                        "input.items",
                        "input.enum",
                        "input.maxLength");
        assertThat(InputSchema.parse(Map.of("type", "object", "properties", "x"), "input", (f, m) -> problems.add(f)))
                .isNull();
        assertThat(InputSchema.parse("x", "input", (f, m) -> problems.add(f))).isNull();
    }
}
