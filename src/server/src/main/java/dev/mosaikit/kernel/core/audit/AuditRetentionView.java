// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

/**
 * The retention of a chain of the audit log (MK-059).
 *
 * @param retentionDays the retention set by the administrators, in days; null keeps every entry
 * @param minimumDays the minimum of the installation, {@code mosaikit.audit.min-retention}
 * @param effectiveDays after how many days entries are deleted: the retention, never below the minimum
 */
public record AuditRetentionView(Integer retentionDays, long minimumDays, Long effectiveDays) {

    /** A change of the retention: days, or null to keep every entry. */
    public record Change(Integer retentionDays) {}
}
