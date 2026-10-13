// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * The credentials of external services that the administrators of an organization keep for its
 * extensions (MK-062). Inject {@link dev.mosaikit.kernel.api.secrets.Secrets} in the backend and read
 * a credential by name at the moment of the call; never send it to the browser. <strong>API
 * preview</strong>: implemented by the kernel with MK-062.
 */
package dev.mosaikit.kernel.api.secrets;
