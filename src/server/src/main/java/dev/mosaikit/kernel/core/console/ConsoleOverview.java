// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.console;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.presence.KernelExtensionPresence;
import java.time.Instant;
import java.util.List;

/**
 * The state of the installation in the console of the platform administrators (MK-072).
 *
 * @param organizations how many organizations, active and suspended
 * @param people how many accounts, and how many are suspended
 * @param extensions the extensions active in the installation
 * @param system the metrics of this instance of the kernel
 * @param security the security events of the last day
 */
public record ConsoleOverview(
        Organizations organizations, People people, Extensions extensions, SystemMetrics system, Security security) {

    /** The organizations of the installation, deleted ones left out. */
    public record Organizations(long total, long active, long suspended) {}

    /** The accounts of the installation. */
    public record People(long total, long suspended) {}

    /** The extensions active in the installation, by identifier. */
    public record Extensions(long active, List<KernelExtensionPresence.Active> list) {}

    /**
     * The metrics of the instance of the kernel that answered.
     *
     * @param version the version of the kernel
     * @param startedAt when it started
     * @param uptimeSeconds for how long it has been running
     * @param heapUsedBytes memory of the Java heap in use
     * @param heapMaxBytes memory the Java heap may grow to
     * @param processors processors available
     * @param threads live threads
     */
    public record SystemMetrics(
            String version,
            Instant startedAt,
            long uptimeSeconds,
            long heapUsedBytes,
            long heapMaxBytes,
            int processors,
            int threads) {}

    /**
     * The entries of the audit log of the platform that were refused or failed.
     *
     * @param since from when they are counted
     * @param failedSignIns how many sign-ins were refused
     * @param events the latest of them, newest first
     */
    public record Security(Instant since, long failedSignIns, List<SecurityEvent> events) {}

    /** A refused or failed entry of the audit log of the platform. */
    public record SecurityEvent(
            Instant occurredAt,
            String actor,
            String action,
            String subject,
            AuditEvent.Outcome outcome,
            String detail) {

        static SecurityEvent of(AuditEvent event) {
            return new SecurityEvent(
                    event.getOccurredAt(),
                    event.getActor(),
                    event.getAction(),
                    event.getSubject().orElse(null),
                    event.getOutcome(),
                    event.getDetail().orElse(null));
        }
    }
}
