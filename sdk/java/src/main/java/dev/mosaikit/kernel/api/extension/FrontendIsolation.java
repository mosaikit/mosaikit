// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

/** How the shell runs the frontend of an extension. */
public enum FrontendIsolation {
    /** Loaded as an ES module in the page. Reserved to trusted extensions. */
    MODULE,
    /** Loaded in a sandboxed iframe that talks to the shell through a message bridge. */
    IFRAME;

    /** The value used in manifests, for example {@code "module"}. */
    public String value() {
        return name().toLowerCase(Locale.ROOT);
    }

    /** Resolves a manifest value, ignoring case. */
    public static Optional<FrontendIsolation> fromValue(String value) {
        return Arrays.stream(values())
                .filter(isolation -> isolation.value().equalsIgnoreCase(value))
                .findFirst();
    }
}
