// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.jobs.OrganizationJobs;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import org.jboss.logging.Logger;

/**
 * Removes the deleted organizations whose retention has passed (MK-130). A job of every kernel looks
 * for them every hour; each is removed in a transaction of its own, as the owner of the tables, and
 * only when it is marked deleted and its {@code removable_from}, set at the deletion, is past: a
 * setting, missing or wrong, never removes an organization that was not deleted, nor one deleted
 * less than a day before (the database checks it too). Several kernels never remove the same one:
 * each locks it first, and skips those another holds.
 *
 * <p>Removing an organization deletes, in one transaction or not at all:
 *
 * <ul>
 *   <li>the rows of the organization in every table of the extensions ({@code ext_*} schemas, also of
 *       extensions no longer installed) that has an {@code organization_id} column, the tables that
 *       reference others first;
 *   <li>its events of the platform, delivered or not;
 *   <li>the organization, and with it every kernel row that belongs to it (members, teams, apps,
 *       resources, grants, permissions, credentials, quotas, records of files...), by the cascades
 *       of the database. The content of its files is queued for the clean-up of the store, which
 *       removes it after {@code mosaikit.files.removal-retention} (V36).
 * </ul>
 *
 * The audit log keeps its entries, and records the removal ({@code organization.removed}).
 */
@ApplicationScoped
public class OrganizationRemovals {

    private static final Logger LOG = Logger.getLogger(OrganizationRemovals.class);

    /** The shortest retention, whatever the setting says. */
    static final Duration MIN_RETENTION = Duration.ofDays(1);

    /** How many organizations one run removes at most. */
    static final int BATCH = 20;

    static final String REMOVED = "organization.removed";

    /** The schemas of extensions, as their manifests name them. */
    private static final String EXTENSION_SCHEMAS = "ext\\_%";

    /**
     * What a removal did.
     *
     * @param extensionRows the rows deleted from the tables of extensions, by schema
     * @param files the contents of files queued for the clean-up of the store
     */
    public record Removed(
            UUID id, String slug, Instant deletedAt, Map<String, Long> extensionRows, long files, long bytes) {}

    private final EntityManager entityManager;
    private final AuditLog audit;
    private final Clock clock;

    public OrganizationRemovals(EntityManager entityManager, AuditLog audit, Clock clock) {
        this.entityManager = entityManager;
        this.audit = audit;
        this.clock = clock;
    }

    /** The retention of a setting, never shorter than {@link #MIN_RETENTION}. */
    public static Duration retention(Duration configured) {
        return configured == null || configured.compareTo(MIN_RETENTION) < 0 ? MIN_RETENTION : configured;
    }

    @Scheduled(
            identity = "mosaikit-organization-removals",
            every = "1h",
            delayed = "15m",
            concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void run() {
        try {
            OrganizationJobs.outsideRequests(() -> removeDue(Instant.now(clock)));
        } catch (Exception e) {
            LOG.warnf(e, "Cannot remove the deleted organizations now; trying again at the next run");
        }
    }

    /**
     * Removes the deleted organizations whose retention is past at {@code now}, each in a transaction
     * of its own; one that cannot be removed stays, for the next run.
     *
     * @return those removed
     */
    public List<Removed> removeDue(Instant now) {
        List<Removed> removed = new ArrayList<>();
        for (UUID id : due(now)) {
            try {
                remove(id, now).ifPresent(removed::add);
            } catch (RuntimeException e) {
                LOG.errorf(e, "Cannot remove the deleted organization %s; trying again at the next run", id);
            }
        }
        return removed;
    }

    private List<UUID> due(Instant now) {
        return asOwner(() -> {
            @SuppressWarnings("unchecked")
            List<Object> ids = entityManager
                    .createNativeQuery("select id from {h-schema}organization where deleted_at is not null"
                            + " and removable_from <= :now order by removable_from")
                    .setParameter("now", Timestamp.from(now))
                    .setMaxResults(BATCH)
                    .getResultList();
            return ids.stream().map(id -> (UUID) id).toList();
        });
    }

    /** Removes one deleted organization whose retention is past; empty when it is not, or is locked. */
    Optional<Removed> remove(UUID id, Instant now) {
        return asOwner(() -> {
            @SuppressWarnings("unchecked")
            List<Object[]> found = entityManager
                    .createNativeQuery("select slug, deleted_at, deleted_by from {h-schema}organization"
                            + " where id = :id and deleted_at is not null and removable_from <= :now"
                            + " and removable_from >= deleted_at + interval '1 day'"
                            + " for update skip locked")
                    .setParameter("id", id)
                    .setParameter("now", Timestamp.from(now))
                    .getResultList();
            if (found.isEmpty()) {
                return Optional.<Removed>empty();
            }
            String slug = (String) found.getFirst()[0];
            Instant deletedAt = instant(found.getFirst()[1]);
            String deletedBy = (String) found.getFirst()[2];
            Map<String, Long> rows = removeExtensionData(id);
            entityManager
                    .createNativeQuery("delete from {h-schema}platform_event where organization_id = :id")
                    .setParameter("id", id)
                    .executeUpdate();
            int organizations = entityManager
                    .createNativeQuery("delete from {h-schema}organization where id = :id and deleted_at is not null")
                    .setParameter("id", id)
                    .executeUpdate();
            if (organizations != 1) {
                throw new IllegalStateException("The organization " + id + " was not removed");
            }
            Object[] files = (Object[]) entityManager
                    .createNativeQuery("select count(*), coalesce(sum(size), 0) from {h-schema}file_removal"
                            + " where organization_id = :id and reason = 'organization'")
                    .setParameter("id", id)
                    .getSingleResult();
            Removed removed = new Removed(id, slug, deletedAt, rows, number(files[0]), number(files[1]));
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("deletedAt", deletedAt.toString());
            detail.put("deletedBy", deletedBy);
            detail.put("extensionRows", rows);
            detail.put("filesQueued", removed.files());
            detail.put("bytesQueued", removed.bytes());
            audit.append(
                    AuditEvent.Channel.JOB,
                    "kernel",
                    Optional.of(id),
                    REMOVED,
                    slug,
                    AuditEvent.Outcome.SUCCEEDED,
                    detail);
            LOG.infof(
                    "Removed the organization %s, deleted on %s: %s rows of extensions, %d files queued",
                    slug, deletedAt, rows, removed.files());
            return Optional.of(removed);
        });
    }

    /** Deletes the rows of the organization from the tables of extensions; how many, by schema. */
    private Map<String, Long> removeExtensionData(UUID id) {
        @SuppressWarnings("unchecked")
        List<Object[]> tables = entityManager
                .createNativeQuery("select c.table_schema, c.table_name from information_schema.columns c"
                        + " join information_schema.tables t"
                        + " on t.table_schema = c.table_schema and t.table_name = c.table_name"
                        + " where c.table_schema like :schemas and c.column_name = 'organization_id'"
                        + " and c.data_type = 'uuid' and t.table_type = 'BASE TABLE'"
                        + " order by c.table_schema, c.table_name")
                .setParameter("schemas", EXTENSION_SCHEMAS)
                .getResultList();
        @SuppressWarnings("unchecked")
        List<Object[]> references = entityManager
                .createNativeQuery("select cn.nspname, child.relname, pn.nspname, parent.relname"
                        + " from pg_constraint k"
                        + " join pg_class child on child.oid = k.conrelid"
                        + " join pg_namespace cn on cn.oid = child.relnamespace"
                        + " join pg_class parent on parent.oid = k.confrelid"
                        + " join pg_namespace pn on pn.oid = parent.relnamespace"
                        + " where k.contype = 'f' and cn.nspname like :schemas")
                .setParameter("schemas", EXTENSION_SCHEMAS)
                .getResultList();
        Map<String, String> schemaOf = new HashMap<>();
        tables.forEach(row -> schemaOf.put(name(row[0], row[1]), (String) row[0]));
        List<String> ordered = referencingFirst(
                tables.stream().map(row -> name(row[0], row[1])).toList(),
                references.stream()
                        .map(row -> List.of(name(row[0], row[1]), name(row[2], row[3])))
                        .toList());
        Map<String, Long> rows = new TreeMap<>();
        for (String table : ordered) {
            // The schema and the table are read from the catalog and quoted as identifiers by
            // name(), so they cannot end the identifier nor add SQL; the organization is bound.
            // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
            int deleted = entityManager
                    .createNativeQuery("delete from " + table + " where organization_id = :id")
                    .setParameter("id", id)
                    .executeUpdate();
            if (deleted > 0) {
                rows.merge(schemaOf.get(table), (long) deleted, Long::sum);
            }
        }
        return rows;
    }

    /**
     * The tables in an order where each comes before the tables it references, so that deleting its
     * rows first leaves no reference behind; the others in their order. A cycle keeps the order given.
     *
     * @param references pairs of a table and a table it references
     */
    static List<String> referencingFirst(List<String> tables, List<List<String>> references) {
        Set<String> known = new LinkedHashSet<>(tables);
        Map<String, Set<String>> referencedBy = new HashMap<>();
        Map<String, Integer> pending = new HashMap<>();
        known.forEach(table -> pending.put(table, 0));
        for (List<String> reference : references) {
            String child = reference.get(0);
            String parent = reference.get(1);
            if (known.contains(child)
                    && known.contains(parent)
                    && !child.equals(parent)
                    && referencedBy
                            .computeIfAbsent(parent, key -> new HashSet<>())
                            .add(child)) {
                pending.merge(parent, 1, Integer::sum);
            }
        }
        // A table is ready once every table that references it is ordered.
        Deque<String> ready = new ArrayDeque<>();
        known.stream().filter(table -> pending.get(table) == 0).forEach(ready::add);
        List<String> ordered = new ArrayList<>();
        Map<String, Set<String>> parents = new HashMap<>();
        referencedBy.forEach((parent, children) -> children.forEach(
                child -> parents.computeIfAbsent(child, key -> new HashSet<>()).add(parent)));
        while (!ready.isEmpty()) {
            String table = ready.poll();
            ordered.add(table);
            for (String parent : parents.getOrDefault(table, Set.of())) {
                if (pending.merge(parent, -1, Integer::sum) == 0) {
                    ready.add(parent);
                }
            }
        }
        known.stream().filter(table -> !ordered.contains(table)).forEach(ordered::add);
        return ordered;
    }

    /** A table as a quoted, qualified identifier. */
    static String name(Object schema, Object table) {
        return quote((String) schema) + "." + quote((String) table);
    }

    private static String quote(String identifier) {
        return '"' + identifier.replace("\"", "\"\"") + '"';
    }

    /** In a transaction of its own, as the owner of the tables. */
    private <T> T asOwner(java.util.concurrent.Callable<T> work) {
        return QuarkusTransaction.requiringNew().call(() -> {
            entityManager
                    .createNativeQuery("select set_config('role', 'none', true)")
                    .getSingleResult();
            return work.call();
        });
    }

    private static Instant instant(Object value) {
        return switch (value) {
            case Instant instant -> instant;
            case Timestamp timestamp -> timestamp.toInstant();
            case java.time.OffsetDateTime offset -> offset.toInstant();
            default -> throw new IllegalStateException("Not a time: " + value);
        };
    }

    private static long number(Object value) {
        return value == null ? 0 : ((Number) value).longValue();
    }
}
