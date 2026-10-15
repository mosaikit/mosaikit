// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.NoSuchFileException;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.concurrent.Callable;
import java.util.stream.Collectors;
import org.jboss.logging.Logger;

/**
 * Removes from the store the content of files that no longer have a record (#102, MK-041): those of
 * deleted files, teams and organizations, which the database queues as their records go
 * ({@code V36}), and those of an extension that was uninstalled, which a platform administrator
 * queues. Nothing leaves the store by itself: the clean-up runs when a platform administrator asks
 * for it, and only for what was queued at least {@code mosaikit.files.removal-retention} before (one
 * day at least), so that a database restored from a backup of that time still finds its files.
 *
 * <p>It refuses to run on a store that does not hold the files the database records, as when
 * {@code mosaikit.files.*} names another directory or bucket; it keeps the files of an extension that
 * is installed again; and it never removes the content of a key that still has a record. Every
 * queuing and every clean-up is audited in the log of the platform.
 */
@ApplicationScoped
public class FileRemovals {

    private static final Logger LOG = Logger.getLogger(FileRemovals.class);

    /** The shortest retention, whatever the setting says. */
    static final Duration MIN_RETENTION = Duration.ofDays(1);

    /** How many contents one round of the clean-up reads from the database. */
    static final int BATCH = 500;

    /** How many recorded files the clean-up reads to check that the store is the right one. */
    static final int SAMPLE = 5;

    static final String QUEUED = "files.removal.queued";
    static final String CLEANED = "files.cleaned";

    /** What waits for the clean-up, and the files of extensions no longer installed. */
    public record Pending(
            long files, long bytes, long due, long dueBytes, Duration retention, List<Uninstalled> uninstalled) {}

    /** The files kept of an extension that is not installed, and how many are queued already. */
    public record Uninstalled(String extension, long files, long bytes, long queued) {}

    /** The files of an uninstalled extension queued for removal. */
    public record Queued(String extension, long files, long bytes, Instant removableFrom) {}

    /**
     * What a clean-up did: contents removed from the store, contents it could not remove (kept for
     * the next one), and files of extensions installed again, kept.
     */
    public record CleanUp(long removed, long bytes, long failed, long kept, Map<String, Long> reasons) {}

    private final EntityManager entityManager;
    private final FileStore store;
    private final ExtensionRegistry extensions;
    private final AuditLog audit;
    private final Duration retention;
    private final Clock clock;

    public FileRemovals(
            EntityManager entityManager,
            FileStore store,
            ExtensionRegistry extensions,
            AuditLog audit,
            KernelConfig config,
            Clock clock) {
        this.entityManager = entityManager;
        this.store = store;
        this.extensions = extensions;
        this.audit = audit;
        this.retention = retention(config.files().removalRetention());
        this.clock = clock;
    }

    /** The retention of a setting, never shorter than {@link #MIN_RETENTION}. */
    static Duration retention(Duration configured) {
        return configured == null || configured.compareTo(MIN_RETENTION) < 0 ? MIN_RETENTION : configured;
    }

    public Duration retention() {
        return retention;
    }

    /** What waits for the clean-up now, and what an uninstalled extension left. */
    public Pending pending() {
        Instant cut = Instant.now(clock).minus(retention);
        return asOwner(() -> {
            Object[] totals = (Object[]) entityManager
                    .createNativeQuery("select count(*), coalesce(sum(size), 0),"
                            + " count(*) filter (where queued_at <= :cut),"
                            + " coalesce(sum(size) filter (where queued_at <= :cut), 0)"
                            + " from {h-schema}file_removal")
                    .setParameter("cut", Timestamp.from(cut))
                    .getSingleResult();
            return new Pending(
                    number(totals[0]),
                    number(totals[1]),
                    number(totals[2]),
                    number(totals[3]),
                    retention,
                    uninstalled());
        });
    }

    private List<Uninstalled> uninstalled() {
        Set<String> installed = installed();
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager
                .createNativeQuery("select f.extension_id, count(*), coalesce(sum(f.size), 0),"
                        + " count(r.storage_key) from {h-schema}stored_file f"
                        + " left join {h-schema}file_removal r on r.storage_key = f.storage_key"
                        + " group by f.extension_id order by f.extension_id")
                .getResultList();
        return rows.stream()
                // The files the kernel keeps for itself, such as the branding of organizations (MK-074),
                // belong to no extension: they are never offered for removal as those of one.
                .filter(row -> !installed.contains((String) row[0]) && !FileService.KERNEL.equals(row[0]))
                .map(row -> new Uninstalled((String) row[0], number(row[1]), number(row[2]), number(row[3])))
                .toList();
    }

    /**
     * Queues the files of an extension that is not installed, in every organization: their records
     * stay until the clean-up removes them with their content, and only if the extension is still not
     * installed then.
     *
     * @throws ConflictException when the extension is installed, or no extension at all is, which
     *     says more of {@code mosaikit.extensions.directory} than of the extension
     * @throws ResourceNotFoundException when the extension has no files
     */
    public Queued queueExtension(String extension, String actor) {
        Set<String> installed = installed();
        if (FileService.KERNEL.equals(extension)) {
            throw new ConflictException("The files of the kernel are not those of an extension: they leave with"
                    + " what they belong to, such as the branding of an organization.");
        }
        if (installed.contains(extension)) {
            throw new ConflictException(
                    "The extension " + extension + " is installed: uninstall it before removing" + " its files.");
        }
        if (installed.isEmpty()) {
            throw new ConflictException("No extension is installed: check mosaikit.extensions.directory before"
                    + " removing the files of one.");
        }
        Instant now = Instant.now(clock);
        Queued queued = asOwner(() -> {
            Object[] found = (Object[]) entityManager
                    .createNativeQuery("select count(*), coalesce(sum(size), 0) from {h-schema}stored_file"
                            + " where extension_id = :extension")
                    .setParameter("extension", extension)
                    .getSingleResult();
            if (number(found[0]) == 0) {
                throw new ResourceNotFoundException("The extension " + extension + " has no files.");
            }
            entityManager
                    .createNativeQuery("insert into {h-schema}file_removal"
                            + " (storage_key, file_id, organization_id, extension_id, size, reason, queued_at)"
                            + " select storage_key, id, organization_id, extension_id, size, 'extension', :now"
                            + " from {h-schema}stored_file where extension_id = :extension"
                            + " on conflict (storage_key) do nothing")
                    .setParameter("extension", extension)
                    .setParameter("now", Timestamp.from(now))
                    .executeUpdate();
            Queued result = new Queued(extension, number(found[0]), number(found[1]), now.plus(retention));
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("extension", extension);
            detail.put("files", result.files());
            detail.put("bytes", result.bytes());
            detail.put("removableFrom", result.removableFrom().toString());
            audit.append(actor, Optional.empty(), QUEUED, extension, AuditEvent.Outcome.SUCCEEDED, detail);
            return result;
        });
        LOG.infof(
                "%s queued the %d files of the uninstalled extension %s for removal", actor, queued.files(), extension);
        return queued;
    }

    /**
     * Removes from the store the contents queued before the retention, and their queue entries. The
     * files of an extension queued then are removed only if it is still not installed; otherwise
     * they are kept, and taken off the queue.
     *
     * @throws ServiceUnavailableException when the store does not hold the files the database
     *     records, so that a wrong setting never makes the clean-up remove anything
     */
    public CleanUp run(String actor) {
        Instant cut = Instant.now(clock).minus(retention);
        requireTheRightStore();
        long kept = settleExtensions(cut);
        long removed = 0;
        long bytes = 0;
        long failed = 0;
        Map<String, Long> reasons = new TreeMap<>();
        String after = "";
        while (true) {
            String from = after;
            List<Object[]> due = asOwner(() -> due(cut, from));
            if (due.isEmpty()) {
                break;
            }
            List<String> done = new ArrayList<>();
            for (Object[] row : due) {
                String key = (String) row[0];
                try {
                    store.delete(key);
                    done.add(key);
                    removed++;
                    bytes += number(row[2]);
                    reasons.merge((String) row[1], 1L, Long::sum);
                } catch (IOException | RuntimeException e) {
                    failed++;
                    LOG.warnf(
                            "Cannot remove %s from %s, kept for the next clean-up: %s",
                            key, store.describe(), e.getMessage());
                }
            }
            if (!done.isEmpty()) {
                asOwner(() -> entityManager
                        .createNativeQuery("delete from {h-schema}file_removal where storage_key in (:keys)")
                        .setParameter("keys", done)
                        .executeUpdate());
            }
            after = (String) due.getLast()[0];
            if (due.size() < BATCH) {
                break;
            }
        }
        CleanUp result = new CleanUp(removed, bytes, failed, kept, reasons);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("removed", removed);
        detail.put("bytes", bytes);
        detail.put("failed", failed);
        detail.put("kept", kept);
        detail.put("reasons", reasons);
        detail.put("retention", retention.toString());
        AuditEvent.Outcome outcome = failed == 0 ? AuditEvent.Outcome.SUCCEEDED : AuditEvent.Outcome.FAILED;
        asOwner(() -> {
            audit.append(actor, Optional.empty(), CLEANED, store.describe(), outcome, detail);
            return null;
        });
        return result;
    }

    /** The contents due for removal after a key, in the order of their keys, with no record left. */
    @SuppressWarnings("unchecked")
    private List<Object[]> due(Instant cut, String after) {
        return entityManager
                .createNativeQuery("select r.storage_key, r.reason, r.size from {h-schema}file_removal r"
                        + " where r.queued_at <= :cut and r.storage_key > :after"
                        + " and not exists (select 1 from {h-schema}stored_file f where f.storage_key = r.storage_key)"
                        + " order by r.storage_key")
                .setParameter("cut", Timestamp.from(cut))
                .setParameter("after", after)
                .setMaxResults(BATCH)
                .getResultList();
    }

    /**
     * The files of the extensions queued before the retention: their records go when the extension is
     * still not installed, and the queue forgets them when it is installed again; how many were kept.
     */
    private long settleExtensions(Instant cut) {
        Set<String> installed = installed();
        return asOwner(() -> {
            @SuppressWarnings("unchecked")
            List<String> queued = entityManager
                    .createNativeQuery("select distinct extension_id from {h-schema}file_removal"
                            + " where reason = 'extension' and queued_at <= :cut")
                    .setParameter("cut", Timestamp.from(cut))
                    .getResultList();
            long kept = 0;
            for (String extension : queued) {
                if (installed.isEmpty()) {
                    // No extension found at all says more of a wrong setting than of this one: the files
                    // stay, and so does the request, for a clean-up once the setting is right.
                    continue;
                }
                if (installed.contains(extension)) {
                    // Installed again: the files stay, and the queue forgets them.
                    kept += entityManager
                            .createNativeQuery("delete from {h-schema}file_removal where reason = 'extension'"
                                    + " and extension_id = :extension and exists (select 1 from {h-schema}stored_file f"
                                    + " where f.storage_key = file_removal.storage_key)")
                            .setParameter("extension", extension)
                            .executeUpdate();
                } else {
                    entityManager
                            .createNativeQuery(
                                    "delete from {h-schema}stored_file where extension_id = :extension"
                                            + " and storage_key in (select storage_key from {h-schema}file_removal"
                                            + " where reason = 'extension' and extension_id = :extension and queued_at <= :cut)")
                            .setParameter("extension", extension)
                            .setParameter("cut", Timestamp.from(cut))
                            .executeUpdate();
                }
            }
            return kept;
        });
    }

    /**
     * Refuses a store that holds none of the files the database records, read from a few of them: a
     * directory or a bucket other than the one of the files.
     */
    private void requireTheRightStore() {
        @SuppressWarnings("unchecked")
        List<String> sample = asOwner(() -> entityManager
                .createNativeQuery(
                        "select storage_key from {h-schema}stored_file where size > 0" + " order by created_at desc")
                .setMaxResults(SAMPLE)
                .getResultList());
        if (sample.isEmpty()) {
            return;
        }
        for (String key : sample) {
            try (InputStream content = store.read(key, 0, 1)) {
                return;
            } catch (NoSuchFileException e) {
                // Not there: try the next one.
            } catch (IOException e) {
                throw new ServiceUnavailableException("The store of files cannot be read now: nothing was removed.");
            }
        }
        throw new ServiceUnavailableException("The store of files (" + store.describe() + ") holds none of the"
                + " files the database records: check mosaikit.files.* before a clean-up. Nothing was removed.");
    }

    private Set<String> installed() {
        return extensions.all().stream().map(InstalledExtension::key).collect(Collectors.toSet());
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

    private static long number(Object value) {
        return value == null ? 0 : ((Number) value).longValue();
    }
}
