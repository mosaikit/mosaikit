// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * The registry of the resources of extensions (MK-054, ADR-0037). Declare the resource types in
 * {@code resources} of the manifest, inject {@link dev.mosaikit.kernel.api.resource.Resources} and
 * register every resource when it is created; sharing and the other generic features of the kernel
 * then work on it. <strong>API preview</strong>: implemented by the kernel with MK-054.
 */
package dev.mosaikit.kernel.api.resource;
