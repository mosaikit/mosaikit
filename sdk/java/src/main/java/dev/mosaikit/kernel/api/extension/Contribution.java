// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.Map;
import java.util.Objects;

/**
 * A contribution of an extension to an extension point.
 *
 * @param point name of the extension point, for example {@code launcher.app}
 * @param id identifier of the contribution, unique within the extension and the point
 * @param attributes attributes defined by the schema of the extension point
 */
public record Contribution(String point, String id, Map<String, Object> attributes) {

    public Contribution {
        Objects.requireNonNull(point, "point");
        Objects.requireNonNull(id, "id");
        attributes = Map.copyOf(attributes);
    }
}
