// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * The quotas of organizations (MK-076). Declare what the extension meters in {@code measures} of
 * the manifest, inject {@link dev.mosaikit.kernel.api.quota.Quotas}, ask it before an action whether
 * it fits, count what the action used, and report the space kept for each resource. Platform
 * administrators set the limits; the administrators of the organization see the consumption.
 */
package dev.mosaikit.kernel.api.quota;
