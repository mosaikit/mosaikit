// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.home;

import dev.mosaikit.kernel.api.extension.Contribution;
import dev.mosaikit.kernel.api.extension.ExtensionPoint;
import dev.mosaikit.kernel.api.extension.InputSchema;
import dev.mosaikit.kernel.core.security.Roles;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

/**
 * The widgets that extensions contribute to the home page of the shell (MK-101, ADR-0039): the kernel
 * owns the extension point {@code home.widget} and types its payload as any point of an extension
 * does (MK-134), so that a widget that does not match is refused at installation with the reason and
 * never reaches the shell.
 *
 * <p>A widget names the roles it appears for ({@code roles}, every signed-in person when absent) and
 * whether anonymous visitors see it ({@code public}). The kernel gives each person only the widgets of
 * their roles, and visitors only the public ones.
 */
public final class HomeWidgets {

    /** The name of the point. */
    public static final String POINT = "home.widget";

    /** The roles a widget may name. */
    public static final List<String> ROLES =
            List.of(Roles.PLATFORM_ADMIN, Roles.ORGANIZATION_ADMIN, Roles.ORGANIZATION_USER, Roles.ORGANIZATION_GUEST);

    /** Version 1 of the point, with the schema of its payload. */
    public static final ExtensionPoint HOME_WIDGET = new ExtensionPoint(POINT, 1, schema());

    private HomeWidgets() {}

    private static InputSchema schema() {
        Map<String, Object> properties = Map.of(
                "element", Map.of("type", "string", "minLength", 3, "maxLength", 100),
                "title", Map.of("type", "string", "minLength", 1, "maxLength", 80),
                "roles", Map.of("type", "array", "minItems", 1, "items", Map.of("type", "string", "enum", ROLES)),
                "public", Map.of("type", "boolean"),
                "size", Map.of("type", "string", "enum", List.of("small", "wide")),
                "order", Map.of("type", "integer", "minimum", 0, "maximum", 1000),
                "permission", Map.of("type", "string", "minLength", 1, "maxLength", 200));
        Map<String, Object> raw = Map.of(
                "type",
                "object",
                "required",
                List.of("element", "title"),
                "additionalProperties",
                false,
                "properties",
                properties);
        List<String> problems = new ArrayList<>();
        InputSchema schema = InputSchema.parse(raw, POINT, (path, message) -> problems.add(path + ": " + message));
        if (schema == null) {
            throw new IllegalStateException("The schema of " + POINT + " is invalid: " + problems);
        }
        return schema;
    }

    /** The point of the kernel that a contribution targets, if it targets one. */
    public static Optional<ExtensionPoint> kernelPoint(String id) {
        return HOME_WIDGET.id().equals(id) ? Optional.of(HOME_WIDGET) : Optional.empty();
    }

    /** Whether a contribution is a widget of the home page. */
    public static boolean isWidget(Contribution contribution) {
        return HOME_WIDGET.id().equals(contribution.point());
    }

    /** Whether a widget appears for anonymous visitors. */
    public static boolean isPublic(Contribution widget) {
        return Boolean.TRUE.equals(widget.attributes().get("public"));
    }

    /**
     * Whether a widget appears for a signed-in person with these roles: for everyone when it names no
     * role, otherwise for those who hold one of them.
     */
    public static boolean appearsFor(Contribution widget, Set<String> roles) {
        if (!(widget.attributes().get("roles") instanceof Collection<?> named) || named.isEmpty()) {
            return true;
        }
        return named.stream().anyMatch(roles::contains);
    }
}
