// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;

/**
 * One major version of an extension point that a frontend offers to other extensions (MK-020,
 * MK-134), with the JSON Schema of the payload of its contributions when it declares one.
 *
 * <p>Contributions name the version they target in the key of {@code contributes}: {@code
 * dashboard.widget} is version 1, {@code dashboard.widget@2} version 2. A breaking change of the
 * payload is a new version next to the old one; the owner serves both until it retires the old one,
 * and receives the contributions of each with {@code contributionsTo(id)}.
 *
 * @param name dotted name of the point, such as {@code dashboard.widget}
 * @param version major version, from 1
 * @param schema the payload of its contributions, {@code null} when the point does not type it
 */
public record ExtensionPoint(String name, int version, InputSchema schema) {

    /** Separates the name of a point from its version in the key of a contribution. */
    public static final String VERSION_SEPARATOR = "@";

    public ExtensionPoint {
        Objects.requireNonNull(name, "name");
        if (version < 1) {
            throw new IllegalArgumentException("The version of an extension point starts at 1");
        }
    }

    /** An untyped point in version 1, as {@code frontend.points} declared them before MK-134. */
    public static ExtensionPoint untyped(String name) {
        return new ExtensionPoint(name, 1, null);
    }

    /** The identifier of the point in its version: {@code name} for version 1, {@code name@version} after. */
    public String id() {
        return id(name, version);
    }

    /** See {@link #id()}. */
    public static String id(String name, int version) {
        return version == 1 ? name : name + VERSION_SEPARATOR + version;
    }

    /** The schema of the payload of its contributions, if it declares one. */
    public Optional<InputSchema> payload() {
        return Optional.ofNullable(schema);
    }

    /**
     * Checks a contribution against the schema of the point: its attributes without {@code i18n}, whose
     * texts the kernel checks itself (MK-053).
     *
     * @return the problems, empty when the contribution matches or the point has no schema
     */
    public List<String> validate(Contribution contribution) {
        if (schema == null) {
            return List.of();
        }
        Map<String, Object> payload = new HashMap<>(contribution.attributes());
        payload.remove("i18n");
        return schema.validate(payload, contribution.id());
    }
}
