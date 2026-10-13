// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.quotas;

import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.DomainException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.QuotaExceededException;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.narayana.jta.TransactionExceptionResult;
import io.quarkus.runtime.configuration.MemorySize;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.YearMonth;
import java.util.List;
import java.util.OptionalLong;
import java.util.UUID;
import java.util.concurrent.Callable;

/**
 * The quotas of organizations as the kernel and extensions meet them (MK-076): what is left of a
 * limit, the consumption of a counter, the space of the resources of extensions, and the check of
 * storage before a file is kept. A limit is the one that a platform administrator set for the
 * organization, or else the default of the installation ({@code mosaikit.quotas.*}); without either
 * there is none.
 *
 * <p>A check that lets an action through locks the row of the total of the measure until the
 * transaction ends, and the action adds to it in the same transaction: two actions of the same
 * organization cannot both pass a limit that only one fits. Every call acts on the organization it is
 * given, which the caller has checked is the one of the request; row-level security keeps the rows
 * to it.
 */
@ApplicationScoped
public class QuotaService {

    /** The period of a gauge. */
    static final String NOW = "";

    /**
     * What an action would do to a quota.
     *
     * @param period the month of a counter, such as {@code 2026-10}, or {@code null} for a gauge
     * @param limit the limit, empty for none
     * @param used what the organization used in the period, or keeps now
     * @param requested what the action needs
     */
    public record Check(Measure measure, String period, OptionalLong limit, long used, long requested) {

        /** Whether the action fits the limit. */
        public boolean fits() {
            return limit.isEmpty() || used + requested <= limit.getAsLong();
        }

        /** What is left before the limit, empty when there is no limit; never negative. */
        public OptionalLong remaining() {
            return limit.isEmpty() ? OptionalLong.empty() : OptionalLong.of(Math.max(0, limit.getAsLong() - used));
        }

        /** The refusal of an action that does not fit, naming the limit. */
        public QuotaExceededException refusal() {
            long max = limit.orElse(Long.MAX_VALUE);
            String message = measure.kind() == Measure.Kind.GAUGE
                    ? "The organization may keep %s of %s (%s): it keeps %s, and this needs %s more."
                            .formatted(
                                    measure.format(max),
                                    measure.label(),
                                    measure.id(),
                                    measure.format(used),
                                    measure.format(requested))
                    : "The organization may use %s of %s (%s) in %s: it used %s, and this needs %s more."
                            .formatted(
                                    measure.format(max),
                                    measure.label(),
                                    measure.id(),
                                    period,
                                    measure.format(used),
                                    measure.format(requested));
            return new QuotaExceededException(
                    message,
                    new QuotaExceededException.Quota(measure.id(), measure.unit(), period, max, used, requested));
        }
    }

    private final EntityManager entityManager;
    private final KernelConfig.Quotas defaults;
    private final Clock clock;

    public QuotaService(EntityManager entityManager, KernelConfig config, Clock clock) {
        this.entityManager = entityManager;
        this.defaults = config.quotas();
        this.clock = clock;
    }

    /** The current period of a measure: this month (UTC) for a counter, {@code ""} for a gauge. */
    public String period(Measure measure) {
        return measure.kind() == Measure.Kind.GAUGE ? NOW : YearMonth.now(clock).toString();
    }

    /** The limit of the installation for a measure, when it has one. */
    public OptionalLong defaultLimit(Measure measure) {
        return defaultLimit(defaults, measure);
    }

    static OptionalLong defaultLimit(KernelConfig.Quotas defaults, Measure measure) {
        if (Measure.STORAGE_ID.equals(measure.id())) {
            return defaults.storage()
                    .map(MemorySize::asLongValue)
                    .map(OptionalLong::of)
                    .orElse(OptionalLong.empty());
        }
        Long value = defaults.limits().get(measure.id());
        return value == null ? OptionalLong.empty() : OptionalLong.of(value);
    }

    /** The limit of an organization for a measure: its own when set, else the one of the installation. */
    public OptionalLong limit(UUID organization, Measure measure) {
        return transaction(() -> {
            List<?> own = entityManager
                    .createNativeQuery(
                            "select limit_value from {h-schema}quota_limit where organization_id = ?1 and measure_id = ?2")
                    .setParameter(1, organization)
                    .setParameter(2, measure.id())
                    .getResultList();
            if (own.isEmpty()) {
                return defaultLimit(measure);
            }
            Object value = own.getFirst();
            return value == null ? OptionalLong.empty() : OptionalLong.of(((Number) value).longValue());
        });
    }

    /** Whether an amount fits what is left, without taking it. */
    public Check check(UUID organization, Measure measure, long amount) {
        requirePositive(amount);
        return transaction(() -> {
            String period = period(measure);
            return new Check(
                    measure,
                    label(period),
                    limit(organization, measure),
                    used(organization, measure.id(), period),
                    amount);
        });
    }

    /**
     * Checks that the organization may keep more bytes, and holds its storage until the transaction
     * of the caller ends, which then stores them: a file of the kernel or the space of a resource.
     *
     * @throws QuotaExceededException when they do not fit
     */
    public void reserveStorage(UUID organization, long bytes) {
        requirePositive(bytes);
        transaction(() -> {
            OptionalLong limit = limit(organization, Measure.STORAGE);
            if (limit.isEmpty() || bytes == 0) {
                return null;
            }
            long used = locked(organization, Measure.STORAGE_ID, NOW);
            Check check = new Check(Measure.STORAGE, null, limit, used, bytes);
            if (!check.fits()) {
                throw check.refusal();
            }
            return null;
        });
    }

    /**
     * Adds an amount to a counter of this month, for a person or for none; refused, adding nothing,
     * when it would pass the limit.
     *
     * @param account the person who consumed it, or {@code null}
     * @return the state of the quota before the amount
     * @throws QuotaExceededException when it does not fit
     */
    public Check consume(UUID organization, UUID account, Measure measure, long amount) {
        requirePositive(amount);
        if (measure.kind() != Measure.Kind.COUNTER) {
            throw new InvalidInputException(
                    List.of(measure.id() + " is a gauge: report what is kept rather than consume it"));
        }
        return transaction(() -> {
            String period = period(measure);
            OptionalLong limit = limit(organization, measure);
            long used = limit.isEmpty()
                    ? used(organization, measure.id(), period)
                    : locked(organization, measure.id(), period);
            Check check = new Check(measure, period, limit, used, amount);
            if (!check.fits()) {
                throw check.refusal();
            }
            if (amount > 0) {
                add(organization, account, measure.id(), period, amount);
            }
            return check;
        });
    }

    /**
     * Sets the space that an extension keeps for one of its resources, counted to the storage of the
     * organization and to the person given. More space must fit the quota; less always passes.
     *
     * @param resource the id of the resource in the registry (MK-054)
     * @param account the person it is counted to, its owner, or {@code null}
     * @throws QuotaExceededException when the space added does not fit
     */
    public void reportSpace(UUID organization, String extension, UUID resource, UUID account, long bytes) {
        requirePositive(bytes);
        transaction(() -> {
            List<?> before = entityManager
                    .createNativeQuery("select bytes from {h-schema}quota_space where resource_id = ?1 for update")
                    .setParameter(1, resource)
                    .getResultList();
            long previous = before.isEmpty() ? 0 : ((Number) before.getFirst()).longValue();
            if (bytes > previous) {
                reserveStorage(organization, bytes - previous);
            }
            if (before.isEmpty()) {
                entityManager
                        .createNativeQuery("insert into {h-schema}quota_space"
                                + " (resource_id, organization_id, extension_id, account_id, bytes, updated_at)"
                                + " values (?1, ?2, ?3, cast(?4 as uuid), ?5, now())")
                        .setParameter(1, resource)
                        .setParameter(2, organization)
                        .setParameter(3, extension)
                        .setParameter(4, account == null ? null : account.toString())
                        .setParameter(5, bytes)
                        .executeUpdate();
            } else if (bytes != previous) {
                entityManager
                        .createNativeQuery(
                                "update {h-schema}quota_space set bytes = ?2, updated_at = now() where resource_id = ?1")
                        .setParameter(1, resource)
                        .setParameter(2, bytes)
                        .executeUpdate();
            }
            return null;
        });
    }

    /** The space reported for a resource, 0 when none. */
    public long space(UUID resource) {
        return transaction(() -> {
            List<?> found = entityManager
                    .createNativeQuery("select bytes from {h-schema}quota_space where resource_id = ?1")
                    .setParameter(1, resource)
                    .getResultList();
            return found.isEmpty() ? 0L : ((Number) found.getFirst()).longValue();
        });
    }

    private long used(UUID organization, String measure, String period) {
        List<?> found = entityManager
                .createNativeQuery("select amount from {h-schema}quota_total"
                        + " where organization_id = ?1 and measure_id = ?2 and period = ?3")
                .setParameter(1, organization)
                .setParameter(2, measure)
                .setParameter(3, period)
                .getResultList();
        return found.isEmpty() ? 0 : ((Number) found.getFirst()).longValue();
    }

    /** The total of a measure in a period, locked until the transaction ends. */
    private long locked(UUID organization, String measure, String period) {
        entityManager
                .createNativeQuery(
                        "insert into {h-schema}quota_total (organization_id, measure_id, period, amount, updated_at)"
                                + " values (?1, ?2, ?3, 0, now()) on conflict on constraint quota_total_pk do nothing")
                .setParameter(1, organization)
                .setParameter(2, measure)
                .setParameter(3, period)
                .executeUpdate();
        return ((Number) entityManager
                        .createNativeQuery("select amount from {h-schema}quota_total"
                                + " where organization_id = ?1 and measure_id = ?2 and period = ?3 for update")
                        .setParameter(1, organization)
                        .setParameter(2, measure)
                        .setParameter(3, period)
                        .getSingleResult())
                .longValue();
    }

    private void add(UUID organization, UUID account, String measure, String period, long amount) {
        entityManager
                .createNativeQuery("insert into {h-schema}quota_total as t"
                        + " (organization_id, measure_id, period, amount, updated_at)"
                        + " values (?1, ?2, ?3, ?4, now()) on conflict on constraint quota_total_pk"
                        + " do update set amount = t.amount + excluded.amount, updated_at = excluded.updated_at")
                .setParameter(1, organization)
                .setParameter(2, measure)
                .setParameter(3, period)
                .setParameter(4, amount)
                .executeUpdate();
        entityManager
                .createNativeQuery("insert into {h-schema}quota_usage as u"
                        + " (organization_id, measure_id, period, account_id, amount, updated_at)"
                        + " values (?1, ?2, ?3, cast(?4 as uuid), ?5, now())"
                        + " on conflict on constraint quota_usage_uk"
                        + " do update set amount = u.amount + excluded.amount, updated_at = excluded.updated_at")
                .setParameter(1, organization)
                .setParameter(2, measure)
                .setParameter(3, period)
                .setParameter(4, account == null ? null : account.toString())
                .setParameter(5, amount)
                .executeUpdate();
    }

    private static String label(String period) {
        return NOW.equals(period) ? null : period;
    }

    private static void requirePositive(long amount) {
        if (amount < 0) {
            throw new InvalidInputException(List.of("the amount must not be negative"));
        }
    }

    /**
     * In the transaction of the caller, or in one of its own. A refusal, which happens before any
     * write, leaves the transaction of the caller as it was.
     */
    private static <T> T transaction(Callable<T> work) {
        return QuarkusTransaction.joiningExisting()
                .exceptionHandler(e -> e instanceof DomainException
                        ? TransactionExceptionResult.COMMIT
                        : TransactionExceptionResult.ROLLBACK)
                .call(work);
    }
}
