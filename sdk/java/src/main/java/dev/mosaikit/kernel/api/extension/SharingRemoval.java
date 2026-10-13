// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.List;
import java.util.Objects;

/**
 * Sharing levels that an update of an extension removes (MK-055): a whole resource type, or some of
 * its levels. The kernel refuses the update when grants exist at these levels, and lists them, so
 * that they are revoked first; a migration declared by the extension may come later.
 *
 * @param type the resource type
 * @param wholeType whether the update removes the type itself
 * @param levels the levels removed: all the levels of the type when the type is removed
 */
public record SharingRemoval(String type, boolean wholeType, List<String> levels) {

    public SharingRemoval {
        Objects.requireNonNull(type, "type");
        levels = List.copyOf(levels);
    }
}
