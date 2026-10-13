// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.List;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * What the frontend of an extension may do through the shell when it runs in an isolated iframe
 * (MK-014): the only events it can publish and receive and the only services it can call.
 * Nothing that is not declared passes the bridge.
 *
 * @param publishes topics the frontend may publish; an entry ending with {@code .*} stands for every
 *     topic below that prefix
 * @param subscribes topics or prefixes the frontend may subscribe to
 * @param services services of the shell the frontend may call, see {@link #KNOWN_SERVICES}
 */
public record FrontendBridge(List<String> publishes, List<String> subscribes, List<String> services) {

    /**
     * Services of the shell: {@code api} calls the backend API of the extension itself ({@code
     * /api/v1/ext/<api>/...}), {@code data} its collections of documents ({@code
     * /api/v1/data/<extension id>/...}, ADR-0031), with the credentials of the signed-in person.
     */
    public static final List<String> KNOWN_SERVICES = List.of("api", "data");

    private static final Pattern SEGMENT = Pattern.compile("[a-z][a-zA-Z0-9-]*");

    /** A bridge that lets nothing through. */
    public static final FrontendBridge NONE = new FrontendBridge(List.of(), List.of(), List.of());

    public FrontendBridge {
        publishes = List.copyOf(Objects.requireNonNull(publishes, "publishes"));
        subscribes = List.copyOf(Objects.requireNonNull(subscribes, "subscribes"));
        services = List.copyOf(Objects.requireNonNull(services, "services"));
    }

    /**
     * Whether the text is a dotted event topic of at least two segments, such as {@code
     * maps.selection.changed}, or a prefix ending with {@code .*}, such as {@code maps.*}: the
     * same rule as the event bus of the SDK.
     */
    public static boolean isTopic(String text) {
        String[] segments = text.split("\\.", -1);
        if (segments.length < 2) {
            return false;
        }
        for (int i = 0; i < segments.length; i++) {
            boolean wildcard = i == segments.length - 1 && segments[i].equals("*");
            if (!wildcard && !SEGMENT.matcher(segments[i]).matches()) {
                return false;
            }
        }
        return true;
    }
}
