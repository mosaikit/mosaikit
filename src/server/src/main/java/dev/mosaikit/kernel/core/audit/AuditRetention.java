// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.jboss.logging.Logger;

/**
 * Deletes the entries of the audit log older than the retention of their organization, never one
 * younger than the minimum of the installation (MK-059). It runs in every kernel: the lock of each
 * chain makes the kernels take turns, and the second finds nothing left to delete. Each deletion is
 * itself recorded in the chain it shortened.
 */
@ApplicationScoped
public class AuditRetention {

    private static final Logger LOG = Logger.getLogger(AuditRetention.class);

    private final AuditLog log;
    private final Clock clock;

    public AuditRetention(AuditLog log, Clock clock) {
        this.log = log;
        this.clock = clock;
    }

    @Scheduled(
            identity = "mosaikit-audit-retention",
            every = "${mosaikit.audit.retention-check:6h}",
            delayed = "1m",
            concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void run() {
        apply(Instant.now(clock));
    }

    /**
     * Deletes the entries past the retention of every chain that has one, counting back from
     * {@code now}; returns how many.
     */
    public int apply(Instant now) {
        int total = 0;
        for (UUID chain : log.chainsWithRetention()) {
            try {
                AuditLog.Pruned pruned = log.prune(chain, now);
                if (pruned.deleted() > 0) {
                    total += pruned.deleted();
                    log.append(
                            AuditEvent.Channel.JOB,
                            "system",
                            AuditChain.PLATFORM.equals(chain) ? Optional.empty() : Optional.of(chain),
                            "audit.entries.deleted",
                            "retention",
                            AuditEvent.Outcome.SUCCEEDED,
                            Map.of("deleted", pruned.deleted(), "throughIndex", pruned.throughIndex()));
                }
            } catch (RuntimeException e) {
                LOG.warnf(e, "Cannot apply the retention of the audit chain %s; trying again at the next run", chain);
            }
        }
        return total;
    }
}
