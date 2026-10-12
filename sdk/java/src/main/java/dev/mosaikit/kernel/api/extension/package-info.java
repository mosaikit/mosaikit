// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * The extension manifest: the public contract through which an extension declares what it is, what it
 * needs and what it contributes.
 *
 * <p>The model is framework-free. The kernel reads manifests from YAML, but validation works on a
 * plain {@code Map} so that the same rules can run in the CLI and in the marketplace.
 */
package dev.mosaikit.kernel.api.extension;
