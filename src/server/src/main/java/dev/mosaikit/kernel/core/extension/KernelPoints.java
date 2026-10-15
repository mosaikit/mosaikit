// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import dev.mosaikit.kernel.api.extension.Contribution;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ExtensionPoint;
import dev.mosaikit.kernel.api.extension.InputSchema;
import dev.mosaikit.kernel.core.home.HomeWidgets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The typed extension points of the kernel itself (MK-134), home.widget (MK-101) and console.panel
 * (MK-072): their contributions are checked against the
 * schema of the version they target, as those to the points of an extension are, when the extension is
 * installed and before the shell receives them.
 */
public final class KernelPoints {

    /** The panels that extensions add to the console of the platform administrators (MK-072). */
    public static final String CONSOLE_PANEL = "console.panel";

    private static final List<ExtensionPoint> POINTS =
            List.of(HomeWidgets.HOME_WIDGET, new ExtensionPoint(CONSOLE_PANEL, 1, consolePanel()));

    private KernelPoints() {}

    /** The typed points of the shell, each version on its own. */
    public static List<ExtensionPoint> points() {
        return POINTS;
    }

    /** The point of the shell with this identifier, {@code name} or {@code name@version}. */
    public static Optional<ExtensionPoint> point(String id) {
        return POINTS.stream().filter(point -> point.id().equals(id)).findFirst();
    }

    /** Why a contribution does not match the point of the shell it targets; empty when it does or targets none. */
    public static List<String> problems(Contribution contribution) {
        return point(contribution.point())
                .map(point -> point.validate(contribution))
                .orElse(List.of());
    }

    /** The contributions of an extension that do not match the points of the kernel, with the reason. */
    public static List<String> contributions(ExtensionManifest contributor) {
        return ContractChecks.kernelContributions(contributor);
    }

    /**
     * {@code console.panel}, version 1: a custom element that the console mounts in a panel with a title,
     * among the panels of the shell, in the order of {@code order} (100 by default), for the people who
     * hold {@code permission} when it names one.
     */
    private static InputSchema consolePanel() {
        Map<String, Object> properties = new LinkedHashMap<>();
        properties.put("element", Map.of("type", "string", "minLength", 3, "maxLength", 100));
        properties.put("title", Map.of("type", "string", "minLength", 1, "maxLength", 80));
        properties.put("description", Map.of("type", "string", "maxLength", 200));
        properties.put("order", Map.of("type", "integer", "minimum", 0, "maximum", 1000));
        properties.put("permission", Map.of("type", "string", "maxLength", 120));
        Map<String, Object> schema = new LinkedHashMap<>();
        schema.put("type", "object");
        schema.put("required", List.of("element", "title"));
        schema.put("additionalProperties", false);
        schema.put("properties", properties);
        List<String> problems = new ArrayList<>();
        InputSchema parsed =
                InputSchema.parse(schema, CONSOLE_PANEL, (path, message) -> problems.add(path + " " + message));
        if (parsed == null) {
            throw new IllegalStateException("The schema of " + CONSOLE_PANEL + " is wrong: " + problems);
        }
        return parsed;
    }
}
