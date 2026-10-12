// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * What the kernel tells the Java code of an extension about the current request (MK-017): the
 * organization it acts on. Inject {@link dev.mosaikit.kernel.api.context.CurrentOrganization} and
 * keep every row of the extension tied to an organization.
 */
package dev.mosaikit.kernel.api.context;
