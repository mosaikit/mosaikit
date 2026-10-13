// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

/** What an action of an extension does, and therefore whether a person must confirm it (MK-015). */
public enum ActionRisk {
    /** Reads data; runs at once. */
    READ,
    /** Changes data; runs only after the person confirms a draft. */
    WRITE,
    /** Starts a process or has effects outside the data; runs only after the person confirms a draft. */
    EXECUTE;

    /** Value as written in manifests. */
    public String value() {
        return name().toLowerCase(Locale.ROOT);
    }

    /** Whether the person must confirm the action before it runs. */
    public boolean needsConfirmation() {
        return this != READ;
    }

    public static Optional<ActionRisk> fromValue(String value) {
        return Arrays.stream(values())
                .filter(risk -> risk.value().equals(value))
                .findFirst();
    }
}
