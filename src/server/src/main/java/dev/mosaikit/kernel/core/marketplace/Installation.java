// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.marketplace;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * A package placed in the plugins directory, which takes effect at the next start (ADR-0004).
 *
 * @param id identifier of the plugin
 * @param version its version
 * @param file name of the package in the plugins directory
 * @param replaced the package it replaces, kept in {@code plugins/.previous}
 * @param publisherKey the trusted key that signed it
 * @param problems what the kernel will report about it at start, such as a missing requirement
 * @param restartRequired {@code true} when the plugin has Java code or a schema, which take effect at
 *     the next start; a plugin with only a frontend and collections is active at once (ADR-0031)
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record Installation(
        String id,
        String version,
        String file,
        String replaced,
        String publisherKey,
        List<String> problems,
        boolean restartRequired) {}
