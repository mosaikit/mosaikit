// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * The registry of the resources of extensions (MK-054, ADR-0037). Declare the resource types in
 * {@code resources} of the manifest, inject {@link dev.mosaikit.kernel.api.resource.Resources} and
 * register every resource when it is created; sharing and the other generic features of the kernel
 * then work on it. <strong>API preview</strong>: implemented by the kernel with MK-054.
 *
 * <p>A resource refers to a resource of another extension by its
 * {@link dev.mosaikit.kernel.api.resource.ResourceRef}, and
 * {@link dev.mosaikit.kernel.api.resource.ResourceReferences} resolves the reference to the resource
 * or to the reason it is not available, such as an extension that is absent (MK-135).
 *
 * <p>{@link dev.mosaikit.kernel.api.resource.Trash} moves a resource to the trash instead of deleting
 * it, from which its owner or an administrator restores it (MK-095).
 */
package dev.mosaikit.kernel.api.resource;
