// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.List;
import java.util.Objects;

/** The outcome of reading a manifest: either a valid manifest or the list of broken rules. */
public sealed interface ManifestParseResult {

    /** A manifest that satisfies every rule. */
    record Valid(ExtensionManifest manifest) implements ManifestParseResult {
        public Valid {
            Objects.requireNonNull(manifest, "manifest");
        }
    }

    /** A manifest that breaks at least one rule. */
    record Invalid(List<ManifestViolation> violations) implements ManifestParseResult {
        public Invalid {
            violations = List.copyOf(violations);
            if (violations.isEmpty()) {
                throw new IllegalArgumentException("An invalid manifest needs at least one violation");
            }
        }
    }
}
