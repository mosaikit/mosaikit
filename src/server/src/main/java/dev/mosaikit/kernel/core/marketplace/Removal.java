// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.marketplace;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * An extension removed from the extensions directory (MK-132).
 *
 * @param id identifier of the extension
 * @param version the version that was installed
 * @param file the package moved to {@code extensions/.previous}
 * @param restartRequired {@code true} when the extension has Java code or a schema, and stops at the
 *     next start; otherwise it stopped at once (ADR-0031)
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record Removal(String id, String version, String file, boolean restartRequired) {}
