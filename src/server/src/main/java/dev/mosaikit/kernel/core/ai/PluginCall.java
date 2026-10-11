// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import static java.nio.charset.StandardCharsets.UTF_8;

import java.net.URLEncoder;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

/**
 * A call to the backend API of a plugin.
 *
 * @param method HTTP method
 * @param path absolute path, under {@code /api/v1/p/<api>/}
 * @param query query parameters, in order
 * @param body JSON body, {@code null} for methods without one
 */
public record PluginCall(String method, String path, List<Map.Entry<String, String>> query, Map<String, Object> body) {

    public PluginCall {
        Objects.requireNonNull(method, "method");
        Objects.requireNonNull(path, "path");
        query = List.copyOf(query);
    }

    /** The path with the query string. */
    public String target() {
        if (query.isEmpty()) {
            return path;
        }
        return path + "?"
                + query.stream()
                        .map(parameter -> encode(parameter.getKey()) + "=" + encode(parameter.getValue()))
                        .collect(Collectors.joining("&"));
    }

    static String encode(String value) {
        return URLEncoder.encode(value, UTF_8).replace("+", "%20");
    }
}
