// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.quotas;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalLong;
import java.util.UUID;

/**
 * The quotas of organizations for administrators (MK-076): the limit and consumption of each
 * measure, the consumption by period and person, and the limits that platform administrators set
 * for one organization. The calls act on the organization given, which the caller has checked the
 * person may see; they read as the owner of the tables, so that a platform administrator sees any
 * organization. The totals move with every action, so what they show is current.
 */
@ApplicationScoped
@Transactional
public class QuotaAdministration {

    /** Where a limit comes from. */
    public enum Source {
        /** Set by a platform administrator for this organization. */
        ORGANIZATION,
        /** The default of the installation, {@code mosaikit.quotas.*}. */
        INSTALLATION,
        /** No limit. */
        NONE
    }

    /**
     * A measure for an organization.
     *
     * @param limit the limit in force, {@code null} for none
     * @param source where it comes from: {@code organization}, {@code installation}, {@code none}
     * @param installationLimit the default of the installation, {@code null} for none
     * @param period the month of a counter, {@code null} for a gauge
     * @param used what the organization used in the period, or keeps now
     */
    public record QuotaView(
            String measure,
            String label,
            String unit,
            String kind,
            String extension,
            Long limit,
            String source,
            Long installationLimit,
            String period,
            long used) {}

    /** A person in a report, or {@code null} for what was used without one or by people who left. */
    public record PersonView(UUID id, String name, String email) {}

    /**
     * What one person, or nobody, used of a measure in a period.
     *
     * @param period the month of a counter, {@code null} for a gauge
     */
    public record UsageRow(String measure, String period, PersonView person, long amount, Instant updatedAt) {}

    /**
     * The consumption of an organization in a month, with the gauges as they are now.
     *
     * @param periods the months with consumption, newest first
     */
    public record UsageReport(String period, List<String> periods, List<UsageRow> rows) {}

    /** A limit to set: {@code null} for none, whatever the default of the installation. */
    public record LimitRequest(Long limit) {}

    private final Measures measures;
    private final QuotaService quotas;
    private final AuditLog audit;
    private final EntityManager entityManager;
    private final Clock clock;

    public QuotaAdministration(
            Measures measures, QuotaService quotas, AuditLog audit, EntityManager entityManager, Clock clock) {
        this.measures = measures;
        this.quotas = quotas;
        this.audit = audit;
        this.entityManager = entityManager;
        this.clock = clock;
    }

    /** Every measure, with its limit and what the organization used of it now. */
    public List<QuotaView> list(UUID organization) {
        asOwner();
        Map<String, Optional<Long>> own = new HashMap<>();
        for (Object row : entityManager
                .createNativeQuery(
                        "select measure_id, limit_value from {h-schema}quota_limit where organization_id = ?1")
                .setParameter(1, organization)
                .getResultList()) {
            Object[] values = (Object[]) row;
            own.put((String) values[0], Optional.ofNullable((Number) values[1]).map(Number::longValue));
        }
        String month = YearMonth.now(clock).toString();
        Map<String, Long> used = new HashMap<>();
        for (Object row : entityManager
                .createNativeQuery("select measure_id, period, amount from {h-schema}quota_total"
                        + " where organization_id = ?1 and period in ('', ?2)")
                .setParameter(1, organization)
                .setParameter(2, month)
                .getResultList()) {
            Object[] values = (Object[]) row;
            used.put(values[0] + "|" + values[1], ((Number) values[2]).longValue());
        }
        List<QuotaView> views = new ArrayList<>();
        for (Measure measure : measures.all()) {
            OptionalLong installation = quotas.defaultLimit(measure);
            Optional<Long> limit;
            Source source;
            if (own.containsKey(measure.id())) {
                limit = own.get(measure.id());
                source = Source.ORGANIZATION;
            } else if (installation.isPresent()) {
                limit = Optional.of(installation.getAsLong());
                source = Source.INSTALLATION;
            } else {
                limit = Optional.empty();
                source = Source.NONE;
            }
            String period = quotas.period(measure);
            views.add(new QuotaView(
                    measure.id(),
                    measure.label(),
                    measure.unit(),
                    measure.kind().value(),
                    measure.extension(),
                    limit.orElse(null),
                    source.name().toLowerCase(Locale.ROOT),
                    installation.isPresent() ? installation.getAsLong() : null,
                    period.isEmpty() ? null : period,
                    used.getOrDefault(measure.id() + "|" + period, 0L)));
        }
        return views;
    }

    /** One measure for an organization. */
    public QuotaView get(UUID organization, String measure) {
        require(measure);
        return list(organization).stream()
                .filter(view -> view.measure().equals(measure))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("No measure " + measure + "."));
    }

    /**
     * The consumption of an organization by measure and person: the counters of a month, this month
     * when none is given, and the gauges now.
     */
    public UsageReport usage(UUID organization, String period) {
        String month = month(period);
        asOwner();
        List<String> periods = new ArrayList<>();
        for (Object value : entityManager
                .createNativeQuery("select distinct period from {h-schema}quota_total"
                        + " where organization_id = ?1 and period <> '' order by period desc")
                .setParameter(1, organization)
                .getResultList()) {
            periods.add((String) value);
        }
        List<UsageRow> rows = new ArrayList<>();
        for (Object row : entityManager
                .createNativeQuery("select u.measure_id, u.period, u.account_id, a.display_name, a.username,"
                        + " u.amount, u.updated_at"
                        + " from {h-schema}quota_usage u left join {h-schema}user_account a on a.id = u.account_id"
                        + " where u.organization_id = ?1 and u.period in ('', ?2) and u.amount <> 0"
                        + " order by u.measure_id, u.period, u.amount desc, a.display_name")
                .setParameter(1, organization)
                .setParameter(2, month)
                .getResultList()) {
            Object[] values = (Object[]) row;
            UUID account = values[2] == null ? null : (UUID) values[2];
            PersonView person =
                    account == null ? null : new PersonView(account, (String) values[3], (String) values[4]);
            String rowPeriod = (String) values[1];
            rows.add(new UsageRow(
                    (String) values[0],
                    rowPeriod.isEmpty() ? null : rowPeriod,
                    person,
                    ((Number) values[5]).longValue(),
                    instant(values[6])));
        }
        return new UsageReport(month, periods, rows);
    }

    /** Sets the limit of a measure for an organization, over the default of the installation. */
    public QuotaView setLimit(UUID organization, String measure, LimitRequest request, String actor) {
        require(measure);
        Long limit = request == null ? null : request.limit();
        if (limit != null && limit < 0) {
            throw new InvalidInputException(List.of("limit must be 0 or more, or null for no limit"));
        }
        asOwner();
        entityManager
                .createNativeQuery("insert into {h-schema}quota_limit"
                        + " (organization_id, measure_id, limit_value, updated_at, updated_by)"
                        + " values (?1, ?2, cast(?3 as bigint), ?4, ?5) on conflict on constraint quota_limit_pk"
                        + " do update set limit_value = excluded.limit_value, updated_at = excluded.updated_at,"
                        + " updated_by = excluded.updated_by")
                .setParameter(1, organization)
                .setParameter(2, measure)
                .setParameter(3, limit == null ? null : limit.toString())
                .setParameter(4, Instant.now(clock))
                .setParameter(5, actor)
                .executeUpdate();
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("measure", measure);
        detail.put("limit", limit == null ? "none" : limit.toString());
        audit.append(
                actor,
                Optional.of(organization),
                "quota.limit.set",
                "quota/" + measure,
                AuditEvent.Outcome.SUCCEEDED,
                detail);
        return get(organization, measure);
    }

    /** Removes the limit of a measure set for an organization: the default of the installation applies. */
    public QuotaView removeLimit(UUID organization, String measure, String actor) {
        require(measure);
        asOwner();
        int removed = entityManager
                .createNativeQuery("delete from {h-schema}quota_limit where organization_id = ?1 and measure_id = ?2")
                .setParameter(1, organization)
                .setParameter(2, measure)
                .executeUpdate();
        if (removed > 0) {
            audit.append(
                    actor,
                    Optional.of(organization),
                    "quota.limit.removed",
                    "quota/" + measure,
                    AuditEvent.Outcome.SUCCEEDED,
                    Map.of("measure", measure));
        }
        return get(organization, measure);
    }

    private Measure require(String measure) {
        return measures.find(measure).orElseThrow(() -> new ResourceNotFoundException("No measure " + measure + "."));
    }

    /** A month such as {@code 2026-10}; this month when absent. */
    String month(String period) {
        if (period == null || period.isBlank()) {
            return YearMonth.now(clock).toString();
        }
        try {
            return YearMonth.parse(period.strip()).toString();
        } catch (DateTimeParseException e) {
            throw new InvalidInputException(List.of("period must be a month such as 2026-10"));
        }
    }

    private static Instant instant(Object value) {
        return switch (value) {
            case Instant instant -> instant;
            case OffsetDateTime time -> time.toInstant();
            case java.sql.Timestamp timestamp -> timestamp.toInstant();
            default -> null;
        };
    }

    /**
     * Runs the rest of the transaction as the owner of the tables, not as the member role of the
     * request (ADR-0018): a platform administrator reads and sets the quotas of any organization. The
     * queries name the organization.
     */
    private void asOwner() {
        entityManager
                .createNativeQuery("select set_config('role', 'none', true)")
                .getSingleResult();
    }
}
