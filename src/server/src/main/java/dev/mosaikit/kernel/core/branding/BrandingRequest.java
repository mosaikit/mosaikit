// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.branding;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import java.util.Map;

/**
 * What the administrators of an organization set of its branding (MK-074); a missing value goes back
 * to the one of the installation.
 *
 * @param displayName shown instead of the name of the product, up to 100 characters
 * @param accent the brand color, {@code #rrggbb}
 * @param light tokens of the light scheme: {@code brand}, {@code background}, {@code surface},
 *     {@code foreground}, {@code muted}, {@code line}, {@code danger}, {@code success}, {@code warning},
 *     {@code focus}, each a {@code #rrggbb} color
 * @param dark tokens of the dark scheme, as {@code light}
 */
public record BrandingRequest(
        @Size(max = 100) String displayName,
        @Pattern(regexp = "^#[0-9a-fA-F]{6}$") String accent,
        @Size(max = 20) Map<String, String> light,
        @Size(max = 20) Map<String, String> dark) {}
