// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * The audit log of the organization (MK-059). Inject {@link dev.mosaikit.kernel.api.audit.AuditLog} and
 * record the sensitive actions of the extension; the kernel adds the person, the organization, the
 * time and the channel, and chains the entry so that an alteration is found. <strong>API
 * preview</strong>: implemented by the kernel with MK-059.
 */
package dev.mosaikit.kernel.api.audit;
