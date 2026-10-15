// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.Map;
import java.util.Objects;

/**
 * A contribution of an extension to an extension point.
 *
 * @param point identifier of the extension point, for example {@code launcher.app}; with the major
 *     version it targets after the first, such as {@code dashboard.widget@2} (MK-134)
 * @param id identifier of the contribution, unique within the extension and the point
 * @param attributes attributes defined by the schema of the extension point
 */
public record Contribution(String point, String id, Map<String, Object> attributes) {

    public Contribution {
        Objects.requireNonNull(point, "point");
        Objects.requireNonNull(id, "id");
        attributes = Map.copyOf(attributes);
    }

    /** The name of the point, without the version: {@code dashboard.widget} (MK-134). */
    public String pointName() {
        int at = point.indexOf(ExtensionPoint.VERSION_SEPARATOR);
        return at < 0 ? point : point.substring(0, at);
    }

    /** The major version of the point that the contribution targets, 1 when the key names none (MK-134). */
    public int pointVersion() {
        int at = point.indexOf(ExtensionPoint.VERSION_SEPARATOR);
        return at < 0 ? 1 : Integer.parseInt(point.substring(at + 1));
    }
}
