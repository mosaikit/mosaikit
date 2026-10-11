// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import dev.mosaikit.kernel.api.plugin.ActionEntry;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * An action of an active plugin, as a tool for assistants and MCP clients (MK-015).
 *
 * @param name {@code <api>__<action>}, unique in the installation
 * @param plugin identifier of the plugin
 * @param api name of the backend API of the plugin
 * @param action the action as declared in the manifest
 */
public record AiTool(String name, String plugin, String api, ActionEntry action) {

    /** Separates the API of the plugin from the name of the action in the name of a tool. */
    public static final String SEPARATOR = "__";

    private static final Pattern PLACEHOLDER = Pattern.compile("\\{([A-Za-z][A-Za-z0-9_-]*)}");
    private static final List<String> WITHOUT_BODY = List.of("GET", "DELETE");

    public AiTool {
        Objects.requireNonNull(name, "name");
        Objects.requireNonNull(plugin, "plugin");
        Objects.requireNonNull(api, "api");
        Objects.requireNonNull(action, "action");
    }

    static AiTool of(String plugin, String api, ActionEntry action) {
        return new AiTool(api + SEPARATOR + action.name(), plugin, api, action);
    }

    /** Whether the person must confirm a draft before the action runs. */
    public boolean needsConfirmation() {
        return action.risk().needsConfirmation();
    }

    /** Checks arguments against the input schema of the action; {@code null} means none. */
    public Map<String, Object> arguments(Object input) {
        Object value = input == null ? Map.of() : input;
        List<String> problems = action.input().validate(value);
        if (!problems.isEmpty()) {
            throw new InvalidInputException(problems);
        }
        Map<String, Object> arguments = new LinkedHashMap<>();
        ((Map<?, ?>) value).forEach((key, argument) -> arguments.put(String.valueOf(key), argument));
        return arguments;
    }

    /**
     * The call to the plugin for valid arguments: the arguments named in the path go into it; the
     * others go into the query for {@code GET} and {@code DELETE}, into the JSON body otherwise.
     */
    public PluginCall call(Map<String, Object> arguments) {
        Map<String, Object> rest = new LinkedHashMap<>(arguments);
        StringBuilder path = new StringBuilder("/api/v1/p/").append(api).append('/');
        Matcher placeholder = PLACEHOLDER.matcher(action.path());
        int last = 0;
        while (placeholder.find()) {
            path.append(action.path(), last, placeholder.start());
            String argument = placeholder.group(1);
            Object value = rest.remove(argument);
            if (!isScalar(value)) {
                throw new InvalidInputException(List.of("input." + argument + " is required, as a string or number"));
            }
            path.append(PluginCall.encode(String.valueOf(value)));
            last = placeholder.end();
        }
        path.append(action.path().substring(last));
        if (!WITHOUT_BODY.contains(action.method())) {
            return new PluginCall(action.method(), path.toString(), List.of(), rest);
        }
        List<Map.Entry<String, String>> query = new ArrayList<>();
        rest.forEach((key, value) -> {
            if (value instanceof List<?> values) {
                values.forEach(item -> query.add(parameter(key, item)));
            } else if (value != null) {
                query.add(parameter(key, value));
            }
        });
        return new PluginCall(action.method(), path.toString(), query, null);
    }

    private static Map.Entry<String, String> parameter(String key, Object value) {
        if (!isScalar(value)) {
            throw new InvalidInputException(List.of("input." + key + " must be a string, number or boolean"));
        }
        return Map.entry(key, String.valueOf(value));
    }

    private static boolean isScalar(Object value) {
        return value instanceof String || value instanceof Number || value instanceof Boolean;
    }
}
