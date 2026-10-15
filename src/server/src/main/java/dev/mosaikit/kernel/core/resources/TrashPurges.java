// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.resources;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.jobs.OrganizationJobs;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import org.jboss.logging.Logger;

/**
 * Deletes for good the resources in the trash whose retention is past (MK-095). A job of every kernel
 * looks for them every hour; each resource that was trashed is deleted, with the resources that went
 * with it, in a transaction of its own, as the owner of the tables, and only when it is in the trash
 * and its {@code purgeable_from}, set when it was trashed, is past: a setting, missing or wrong, never
 * deletes a resource that is not in the trash, nor one trashed less than a day before (the database
 * checks it too). Several kernels never delete the same one: each locks it first, and skips those
 * another holds.
 */
@ApplicationScoped
public class TrashPurges {

    private static final Logger LOG = Logger.getLogger(TrashPurges.class);

    /** How many trashed resources one run deletes at most. */
    static final int BATCH = 200;

    private final EntityManager entityManager;
    private final KernelTrash trash;
    private final Clock clock;

    public TrashPurges(EntityManager entityManager, KernelTrash trash, Clock clock) {
        this.entityManager = entityManager;
        this.trash = trash;
        this.clock = clock;
    }

    @Scheduled(
            identity = "mosaikit-trash-purges",
            every = "1h",
            delayed = "20m",
            concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void run() {
        try {
            OrganizationJobs.outsideRequests(() -> purgeDue(Instant.now(clock)));
        } catch (Exception e) {
            LOG.warnf(e, "Cannot empty the trash now; trying again at the next run");
        }
    }

    /**
     * Deletes the resources of the trash whose retention is past at {@code now}, each in a transaction
     * of its own; one that cannot be deleted stays, for the next run.
     *
     * @return how many resources were deleted, those that went with them included
     */
    public int purgeDue(Instant now) {
        int purged = 0;
        for (Object[] due : due(now)) {
            UUID root = (UUID) due[0];
            UUID organization = (UUID) due[1];
            try {
                purged += asOwner(() -> purge(organization, root, now));
            } catch (RuntimeException e) {
                LOG.errorf(e, "Cannot delete the resource %s of the trash; trying again at the next run", root);
            }
        }
        if (purged > 0) {
            LOG.infof("Deleted %d resources of the trash whose retention is past", purged);
        }
        return purged;
    }

    private List<Object[]> due(Instant now) {
        return asOwner(() -> {
            @SuppressWarnings("unchecked")
            List<Object[]> rows = entityManager
                    .createNativeQuery("select id, organization_id from {h-schema}resource"
                            + " where trash_root_id = id and purgeable_from <= :now order by purgeable_from")
                    .setParameter("now", Timestamp.from(now))
                    .setMaxResults(BATCH)
                    .getResultList();
            return rows;
        });
    }

    /** Deletes one trashed resource whose retention is past; nothing when it is not, or is locked. */
    private int purge(UUID organization, UUID root, Instant now) {
        @SuppressWarnings("unchecked")
        List<Object> found = entityManager
                .createNativeQuery("select id from {h-schema}resource"
                        + " where id = :id and trash_root_id = id and trashed_at is not null"
                        + " and purgeable_from <= :now and purgeable_from >= trashed_at + interval '1 day'"
                        + " for update skip locked")
                .setParameter("id", root)
                .setParameter("now", Timestamp.from(now))
                .getResultList();
        if (found.isEmpty()) {
            return 0;
        }
        return trash.purge(organization, root, AuditEvent.Channel.JOB, "kernel", "retention");
    }

    /** In a transaction of its own, as the owner of the tables. */
    private <T> T asOwner(Callable<T> work) {
        return QuarkusTransaction.requiringNew().call(() -> {
            entityManager
                    .createNativeQuery("select set_config('role', 'none', true)")
                    .getSingleResult();
            return work.call();
        });
    }
}
