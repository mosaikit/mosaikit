// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.events;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * The deliveries of events of the platform (MK-085), as the owner of their tables. A kernel claims
 * the deliveries that are due for a while (a lease), so that several kernels never hand the same one
 * at once, and one that stopped while handing it lets another take it when the lease ends.
 */
@ApplicationScoped
public class PlatformEventStore {

    /** Longest error kept with a delivery. */
    static final int MAX_ERROR = 1000;

    private static final String DELIVERED = "update {h-schema}platform_delivery set delivered_at = :now,"
            + " last_error = null where event_id = :event and subscriber = :subscriber";
    private static final String RETRY = "update {h-schema}platform_delivery set next_attempt_at = :next,"
            + " last_error = :error where event_id = :event and subscriber = :subscriber";
    private static final String GIVE_UP = "update {h-schema}platform_delivery set failed_at = :now,"
            + " last_error = :error where event_id = :event and subscriber = :subscriber";

    private final EntityManager entityManager;

    public PlatformEventStore(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    /** A delivery claimed by this kernel, with its event. */
    public record Due(
            long event,
            String subscriber,
            int attempt,
            UUID organization,
            String type,
            String source,
            String payload,
            Instant occurredAt) {}

    /**
     * Claims up to {@code limit} deliveries due at {@code now}, oldest first, until {@code leasedUntil};
     * each claim counts as an attempt.
     */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public List<Due> claim(Instant now, int limit, Instant leasedUntil) {
        asOwner();
        List<?> claimed = entityManager
                .createNativeQuery("with due as (select event_id, subscriber from {h-schema}platform_delivery"
                        + " where delivered_at is null and failed_at is null and next_attempt_at <= :now"
                        + " order by next_attempt_at, event_id limit :limit for update skip locked)"
                        + " update {h-schema}platform_delivery d set attempts = d.attempts + 1,"
                        + " next_attempt_at = :leased from due"
                        + " where d.event_id = due.event_id and d.subscriber = due.subscriber"
                        + " returning d.event_id, d.subscriber, d.attempts")
                .setParameter("now", now)
                .setParameter("limit", limit)
                .setParameter("leased", leasedUntil)
                .getResultList();
        if (claimed.isEmpty()) {
            return List.of();
        }
        List<Long> ids = claimed.stream()
                .map(Object[].class::cast)
                .map(row -> ((Number) row[0]).longValue())
                .distinct()
                .toList();
        Map<Long, Object[]> events = new HashMap<>();
        List<?> rows = entityManager
                .createNativeQuery("select id, organization_id, type, source, payload, created_at"
                        + " from {h-schema}platform_event where id in (:ids)")
                .setParameter("ids", ids)
                .getResultList();
        rows.stream().map(Object[].class::cast).forEach(row -> events.put(((Number) row[0]).longValue(), row));
        return claimed.stream()
                .map(Object[].class::cast)
                .map(row -> {
                    Object[] event = events.get(((Number) row[0]).longValue());
                    return new Due(
                            ((Number) row[0]).longValue(),
                            (String) row[1],
                            ((Number) row[2]).intValue(),
                            (UUID) event[1],
                            (String) event[2],
                            (String) event[3],
                            (String) event[4],
                            instant(event[5]));
                })
                .sorted(Comparator.comparingLong(Due::event))
                .toList();
    }

    /** Marks a delivery made. */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public void delivered(Due due, Instant now) {
        update(DELIVERED, due, Map.of("now", now));
    }

    /** Gives a delivery again at {@code next}, keeping why it failed. */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public void retry(Due due, Instant next, String error) {
        update(RETRY, due, Map.of("next", next, "error", cut(error)));
    }

    /** Gives a delivery up, or skips it, keeping why. */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public void giveUp(Due due, Instant now, String error) {
        update(GIVE_UP, due, Map.of("now", now, "error", cut(error)));
    }

    /**
     * Deletes the events raised before {@code before} whose deliveries were all made or given up;
     * returns how many.
     */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public int prune(Instant before) {
        asOwner();
        return entityManager
                .createNativeQuery("delete from {h-schema}platform_event e where e.created_at < :before"
                        + " and not exists (select 1 from {h-schema}platform_delivery d where d.event_id = e.id"
                        + " and d.delivered_at is null and d.failed_at is null)")
                .setParameter("before", before)
                .executeUpdate();
    }

    /** The state of the delivery of an event to a subscriber, for the tests and the logs. */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public Optional<State> state(long event, String subscriber) {
        asOwner();
        List<?> rows = entityManager
                .createNativeQuery(
                        "select attempts, delivered_at, failed_at, last_error from {h-schema}platform_delivery"
                                + " where event_id = :event and subscriber = :subscriber")
                .setParameter("event", event)
                .setParameter("subscriber", subscriber)
                .getResultList();
        return rows.stream()
                .findFirst()
                .map(Object[].class::cast)
                .map(row -> new State(((Number) row[0]).intValue(), row[1] != null, row[2] != null, (String) row[3]));
    }

    /** What happened to a delivery. */
    public record State(int attempts, boolean delivered, boolean failed, String lastError) {}

    private void update(String statement, Due due, Map<String, Object> parameters) {
        asOwner();
        var query = entityManager
                .createNativeQuery(statement)
                .setParameter("event", due.event())
                .setParameter("subscriber", due.subscriber());
        parameters.forEach(query::setParameter);
        query.executeUpdate();
    }

    private static String cut(String error) {
        if (error == null) {
            return null;
        }
        return error.length() <= MAX_ERROR ? error : error.substring(0, MAX_ERROR);
    }

    private static Instant instant(Object value) {
        return switch (value) {
            case Instant instant -> instant;
            case OffsetDateTime time -> time.toInstant();
            case Timestamp timestamp -> timestamp.toInstant();
            default -> throw new IllegalStateException("Unexpected time " + value);
        };
    }

    /** The rest of the transaction as the owner of the tables, whatever the connection was given. */
    private void asOwner() {
        entityManager
                .createNativeQuery("select set_config('role', 'none', true)")
                .getSingleResult();
    }
}
