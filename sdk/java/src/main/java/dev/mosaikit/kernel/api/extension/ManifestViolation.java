// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

/**
 * A rule broken by a manifest.
 *
 * @param field dotted path of the offending field, for example {@code frontend.entry}
 * @param message what is wrong and how to fix it
 */
public record ManifestViolation(String field, String message) {}
