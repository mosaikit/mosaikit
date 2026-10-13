// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * Permissions declared by extensions and granted through profiles, groups and personal exceptions
 * (MK-056, ADR-0038). Declare them in {@code permissions} of the manifest, inject
 * {@link dev.mosaikit.kernel.api.permission.Permissions} and check them in the backend at every
 * request. Outside its extension a permission is named {@code <extension>:<permission>}
 * ({@link dev.mosaikit.kernel.api.permission.PermissionId}). <strong>API preview</strong>: implemented by
 * the kernel with MK-056.
 */
package dev.mosaikit.kernel.api.permission;
