// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.console;

import dev.mosaikit.kernel.core.account.PlatformPeople;
import dev.mosaikit.kernel.core.account.SessionResource;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.audit.AuditQuery;
import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.OrganizationService;
import dev.mosaikit.kernel.core.presence.KernelExtensionPresence;
import dev.mosaikit.kernel.core.system.KernelVersion;
import jakarta.enterprise.context.ApplicationScoped;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryUsage;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

/**
 * What the console of the platform administrators shows of the installation (MK-072): its
 * organizations, its people, the active extensions, the metrics of the system and the security
 * events of the last day, such as refused sign-ins.
 */
@ApplicationScoped
public class PlatformConsole {

    /** How far back the console looks for security events. */
    static final Duration SECURITY_WINDOW = Duration.ofHours(24);

    /** How many security events the console lists. */
    static final int LISTED_EVENTS = 20;

    private final OrganizationService organizations;
    private final PlatformPeople people;
    private final KernelExtensionPresence extensions;
    private final AuditLog audit;
    private final KernelVersion version;
    private final Clock clock;

    public PlatformConsole(
            OrganizationService organizations,
            PlatformPeople people,
            KernelExtensionPresence extensions,
            AuditLog audit,
            KernelVersion version,
            Clock clock) {
        this.organizations = organizations;
        this.people = people;
        this.extensions = extensions;
        this.audit = audit;
        this.version = version;
        this.clock = clock;
    }

    /** The state of the installation now. */
    public ConsoleOverview overview() {
        List<Organization> all = organizations.all();
        long suspendedOrganizations =
                all.stream().filter(Organization::isSuspended).count();
        PlatformPeople.Counts counts = people.counts();
        List<KernelExtensionPresence.Active> active = extensions.activeIn(Optional.empty());
        return new ConsoleOverview(
                new ConsoleOverview.Organizations(
                        all.size(), all.size() - suspendedOrganizations, suspendedOrganizations),
                new ConsoleOverview.People(counts.people(), counts.suspended()),
                new ConsoleOverview.Extensions(active.size(), active),
                system(),
                security());
    }

    private ConsoleOverview.SystemMetrics system() {
        var runtime = ManagementFactory.getRuntimeMXBean();
        MemoryUsage heap = ManagementFactory.getMemoryMXBean().getHeapMemoryUsage();
        return new ConsoleOverview.SystemMetrics(
                version.get().toString(),
                Instant.ofEpochMilli(runtime.getStartTime()),
                Duration.ofMillis(runtime.getUptime()).toSeconds(),
                heap.getUsed(),
                heap.getMax() < 0 ? heap.getCommitted() : heap.getMax(),
                Runtime.getRuntime().availableProcessors(),
                ManagementFactory.getThreadMXBean().getThreadCount());
    }

    /**
     * The entries of the audit log of the platform refused or failed in the last day, among its latest
     * {@value AuditLog#MAX_EVENTS}.
     */
    private ConsoleOverview.Security security() {
        Instant now = Instant.now(clock);
        Instant from = now.minus(SECURITY_WINDOW);
        List<AuditEvent> refused = audit
                .search(new AuditQuery(
                        Optional.empty(), true, null, null, null, null, from, null, 0, AuditLog.MAX_EVENTS))
                .stream()
                .filter(event -> event.getOutcome() != AuditEvent.Outcome.SUCCEEDED)
                .toList();
        long failedSignIns = refused.stream()
                .filter(event -> SessionResource.SIGN_IN_FAILED.equals(event.getAction()))
                .count();
        return new ConsoleOverview.Security(
                from,
                failedSignIns,
                refused.stream()
                        .limit(LISTED_EVENTS)
                        .map(ConsoleOverview.SecurityEvent::of)
                        .toList());
    }
}
