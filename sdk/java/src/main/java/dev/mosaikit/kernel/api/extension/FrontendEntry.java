// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.List;
import java.util.Objects;

/**
 * The frontend of an extension.
 *
 * @param entry path of the ES module, relative to the extension root
 * @param isolation how the shell runs the module
 * @param bridge what the frontend may do through the shell when it runs in an iframe (MK-014)
 * @param points extension points that the frontend offers to other extensions, such as {@code
 *     activities.detail} (MK-020); the frontend reads the contributions made to them
 */
public record FrontendEntry(String entry, FrontendIsolation isolation, FrontendBridge bridge, List<String> points) {

    public FrontendEntry {
        Objects.requireNonNull(entry, "entry");
        Objects.requireNonNull(isolation, "isolation");
        bridge = Objects.requireNonNullElse(bridge, FrontendBridge.NONE);
        points = List.copyOf(Objects.requireNonNullElse(points, List.of()));
    }

    /** A frontend that offers no extension point. */
    public FrontendEntry(String entry, FrontendIsolation isolation, FrontendBridge bridge) {
        this(entry, isolation, bridge, List.of());
    }

    /** A frontend without a bridge declaration. */
    public FrontendEntry(String entry, FrontendIsolation isolation) {
        this(entry, isolation, FrontendBridge.NONE);
    }
}
