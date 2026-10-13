// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * The file service of the kernel (MK-041, ADR-0029). Inject {@link
 * dev.mosaikit.kernel.api.files.FileStorage} to store and read files of the organization and of its
 * teams, with the rights of the person, without holding the credentials of the store.
 * <strong>API preview</strong>: implemented by the kernel with MK-041.
 */
package dev.mosaikit.kernel.api.files;
