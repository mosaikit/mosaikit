// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.account.AccessKeyRegistry;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import io.quarkus.arc.Arc;
import io.quarkus.arc.ArcContainer;
import io.quarkus.arc.InstanceHandle;
import io.quarkus.vertx.http.runtime.CurrentVertxRequest;
import io.quarkus.vertx.http.runtime.security.QuarkusHttpUser;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.persistence.TypedQuery;
import jakarta.transaction.Transactional;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.jboss.logging.Logger;

/**
 * The audit log of the installation (MK-015, MK-059). Each event is written in its own transaction,
 * so that it is kept even when the operation it records fails, and to the {@code mosaikit.audit}
 * log category, so that it can be sent to a SIEM.
 *
 * <p>Each organization has one chain of entries, and the platform one (see {@link AuditChain}): an
 * entry is appended under a row lock of its chain ({@code audit_chain}), so that concurrent writers,
 * in one kernel or several, keep the chain in order. The kernel reads and writes the log as the owner
 * of the tables and filters its own queries; the member role of requests may not change nor delete
 * an entry. Nothing here changes an entry; only the retention deletes the oldest ones, keeping the
 * hash of the last deleted one as the anchor of the chain.
 */
@ApplicationScoped
public class AuditLog {

    /** Most events returned by one query. */
    public static final int MAX_EVENTS = 500;

    /** Entries read at a time by the verification. */
    private static final int VERIFY_BATCH = 1000;

    private static final long SECONDS_PER_DAY = Duration.ofDays(1).toSeconds();

    /** The chain of a row, as the unique index of the chains computes it. */
    private static final String CHAIN = "coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid)";

    private static final Logger LOG = Logger.getLogger("mosaikit.audit");

    private final EntityManager entityManager;
    private final ObjectMapper json;
    private final Clock clock;
    private final KernelConfig config;

    public AuditLog(EntityManager entityManager, ObjectMapper json, Clock clock, KernelConfig config) {
        this.entityManager = entityManager;
        this.json = json;
        this.clock = clock;
        this.config = config;
    }

    /**
     * Records an event, through the channel of the current call: {@link AuditEvent.Channel#API_KEY} in
     * a request authenticated with a personal access key (MK-060), {@link AuditEvent.Channel#WEB} in
     * other requests, {@link AuditEvent.Channel#JOB} outside requests.
     */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public void append(
            String actor,
            Optional<UUID> organization,
            String action,
            String subject,
            AuditEvent.Outcome outcome,
            Map<String, ?> detail) {
        append(currentChannel(), actor, organization, action, subject, outcome, detail);
    }

    /** Records an event that came through the given channel; returns it. */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public AuditEvent append(
            AuditEvent.Channel channel,
            String actor,
            Optional<UUID> organization,
            String action,
            String subject,
            AuditEvent.Outcome outcome,
            Map<String, ?> detail) {
        asOwner();
        String details = write(detail);
        UUID chain = AuditChain.of(organization.orElse(null));
        Head head = lock(chain);
        AuditEvent event = new AuditEvent(
                AuditChain.truncate(Instant.now(clock)),
                actor,
                organization.orElse(null),
                channel,
                action,
                subject,
                outcome,
                details);
        event.chain(head.lastIndex() + 1, head.lastHash());
        entityManager.persist(event);
        entityManager.flush();
        entityManager
                .createNativeQuery(
                        "update {h-schema}audit_chain set last_index = :index, last_hash = :hash where chain_id = :chain")
                .setParameter("index", event.getChainIndex())
                .setParameter("hash", event.getHash())
                .setParameter("chain", chain)
                .executeUpdate();
        LOG.infof(
                "%s %s by %s via %s in %s on %s: %s [#%d %s]",
                action,
                outcome,
                actor,
                channel,
                organization.map(UUID::toString).orElse("-"),
                subject,
                details,
                event.getChainIndex(),
                event.getHash());
        return event;
    }

    /** The latest events, newest first; of one organization when given. */
    @Transactional
    public List<AuditEvent> latest(Optional<UUID> organization, int limit) {
        return search(AuditQuery.latest(organization, limit));
    }

    /** The events that match a query, newest first. */
    @Transactional
    public List<AuditEvent> search(AuditQuery query) {
        asOwner();
        List<String> where = new ArrayList<>();
        Map<String, Object> parameters = new LinkedHashMap<>();
        if (query.platform()) {
            where.add("e.organizationId is null");
        } else {
            query.organization().ifPresent(id -> {
                where.add("e.organizationId = :organization");
                parameters.put("organization", id);
            });
        }
        if (query.actor() != null) {
            where.add("e.actor = :actor");
            parameters.put("actor", query.actor());
        }
        if (query.action() != null) {
            // An action, or every action under a prefix that ends with a dot, such as "permissions.".
            if (query.action().endsWith(".")) {
                where.add("e.action like :action escape '!'");
                parameters.put("action", query.action().replaceAll("([!%_])", "!$1") + "%");
            } else {
                where.add("e.action = :action");
                parameters.put("action", query.action());
            }
        }
        if (query.subject() != null) {
            where.add("e.subject = :subject");
            parameters.put("subject", query.subject());
        }
        if (query.channel() != null) {
            where.add("e.channel = :channel");
            parameters.put("channel", query.channel());
        }
        if (query.from() != null) {
            where.add("e.occurredAt >= :from");
            parameters.put("from", query.from());
        }
        if (query.to() != null) {
            where.add("e.occurredAt < :to");
            parameters.put("to", query.to());
        }
        String jpql = "from AuditEvent e"
                + (where.isEmpty() ? "" : " where " + String.join(" and ", where))
                + " order by e.occurredAt desc, e.chainIndex desc, e.id";
        TypedQuery<AuditEvent> typed = entityManager.createQuery(jpql, AuditEvent.class);
        parameters.forEach(typed::setParameter);
        return typed.setFirstResult(Math.max(0, query.offset()))
                .setMaxResults(Math.clamp(query.limit(), 1, MAX_EVENTS))
                .getResultList();
    }

    /**
     * Walks the chain of an organization, or of the platform for none, from its anchor, and reports
     * the first entry that is not as it was written: changed, missing, or not appended by the kernel.
     */
    @Transactional
    public AuditVerification verify(Optional<UUID> organization) {
        asOwner();
        UUID chain = AuditChain.of(organization.orElse(null));
        Optional<Head> head = head(chain, false);
        long first = head.map(Head::anchorIndex).orElse(0L) + 1;
        long last = head.map(Head::lastIndex).orElse(0L);
        long expected = first;
        String previousHash = head.map(Head::anchorHash).orElse(AuditChain.GENESIS);
        AuditEvent previous = null;
        long checked = 0;
        List<AuditEvent> batch;
        do {
            batch = entries(organization, expected - 1);
            for (AuditEvent entry : batch) {
                if (entry.getChainIndex() != expected) {
                    return AuditVerification.altered(checked, expected, null, AuditVerification.Problem.MISSING);
                }
                if (!AuditChain.hash(entry).equals(entry.getHash())) {
                    return AuditVerification.altered(
                            checked, expected, entry.getId(), AuditVerification.Problem.CHANGED);
                }
                if (!entry.getPreviousHash().equals(previousHash)) {
                    // The entry before was changed and given a new hash; or this is the first one left
                    // and its link to the anchor was changed.
                    AuditEvent changed = previous == null ? entry : previous;
                    return AuditVerification.altered(
                            checked, changed.getChainIndex(), changed.getId(), AuditVerification.Problem.CHANGED);
                }
                previous = entry;
                previousHash = entry.getHash();
                expected++;
                checked++;
            }
            entityManager.clear();
        } while (batch.size() == VERIFY_BATCH);
        if (expected - 1 < last) {
            return AuditVerification.altered(checked, expected, null, AuditVerification.Problem.MISSING);
        }
        if (previous != null
                && (expected - 1 > last
                        || !previousHash.equals(head.orElseThrow().lastHash()))) {
            // Entries after the last one the kernel appended, or the last one given a new hash.
            long index = Math.min(previous.getChainIndex(), last + 1);
            return AuditVerification.altered(checked, index, null, AuditVerification.Problem.CHANGED);
        }
        return AuditVerification.intact(checked, first, last);
    }

    /** The retention of the chain of an organization, or of the platform for none. */
    @Transactional
    public AuditRetentionView retention(Optional<UUID> organization) {
        asOwner();
        Integer days = head(AuditChain.of(organization.orElse(null)), false)
                .map(Head::retentionDays)
                .orElse(null);
        return view(days);
    }

    /**
     * Sets the retention of a chain, in days, never below the minimum of the installation; null keeps
     * every entry.
     *
     * @throws InvalidInputException when the retention is below the minimum
     */
    @Transactional
    public AuditRetentionView changeRetention(Optional<UUID> organization, Integer days) {
        long minimum = minimumDays();
        if (days != null && days < minimum) {
            throw new InvalidInputException(List.of("retentionDays must be at least " + minimum
                    + " days, the minimum of the installation (mosaikit.audit.min-retention)"));
        }
        asOwner();
        UUID chain = AuditChain.of(organization.orElse(null));
        lock(chain);
        entityManager
                .createNativeQuery("update {h-schema}audit_chain set retention_days = :days where chain_id = :chain")
                .setParameter("days", days)
                .setParameter("chain", chain)
                .executeUpdate();
        return view(days);
    }

    /** The chains whose retention is set. */
    @Transactional
    public List<UUID> chainsWithRetention() {
        asOwner();
        return entityManager
                .createNativeQuery(
                        "select chain_id from {h-schema}audit_chain where retention_days is not null", UUID.class)
                .getResultList()
                .stream()
                .map(UUID.class::cast)
                .toList();
    }

    /**
     * Deletes the oldest entries of a chain, those older than its retention, never one younger than
     * the minimum of the installation. Only a prefix of the chain goes, and the hash of the last entry
     * deleted becomes the anchor the chain is verified from. The retention counts back from {@code now}.
     */
    @Transactional
    public Pruned prune(UUID chain, Instant now) {
        asOwner();
        Head head = lock(chain);
        if (head.retentionDays() == null) {
            return new Pruned(0, head.anchorIndex());
        }
        long days = Math.max(head.retentionDays(), minimumDays());
        Instant cutoff = now.minus(Duration.ofDays(days));
        // Every entry before the first one younger than the cutoff is older: a prefix of the chain.
        Number firstKept = (Number) entityManager
                .createNativeQuery("select min(chain_index) from {h-schema}audit_event where " + CHAIN
                        + " = :chain and occurred_at >= :cutoff")
                .setParameter("chain", chain)
                .setParameter("cutoff", cutoff)
                .getSingleResult();
        long through = firstKept == null ? head.lastIndex() : firstKept.longValue() - 1;
        if (through <= head.anchorIndex()) {
            return new Pruned(0, head.anchorIndex());
        }
        List<?> anchor = entityManager
                .createNativeQuery(
                        "select hash from {h-schema}audit_event where " + CHAIN + " = :chain and chain_index = :index",
                        String.class)
                .setParameter("chain", chain)
                .setParameter("index", through)
                .getResultList();
        if (anchor.isEmpty()) {
            LOG.warnf(
                    "The audit chain %s has no entry %d: its oldest entries are kept; verify the chain",
                    chain, through);
            return new Pruned(0, head.anchorIndex());
        }
        int deleted = entityManager
                .createNativeQuery(
                        "delete from {h-schema}audit_event where " + CHAIN + " = :chain and chain_index <= :index")
                .setParameter("chain", chain)
                .setParameter("index", through)
                .executeUpdate();
        entityManager
                .createNativeQuery(
                        "update {h-schema}audit_chain set anchor_index = :index, anchor_hash = :hash where chain_id = :chain")
                .setParameter("index", through)
                .setParameter("hash", anchor.getFirst())
                .setParameter("chain", chain)
                .executeUpdate();
        return new Pruned(deleted, through);
    }

    /** What a pruning deleted: how many entries, through which position of the chain. */
    public record Pruned(int deleted, long throughIndex) {}

    /** The minimum retention of the installation, in whole days, at least one. */
    public long minimumDays() {
        long seconds = config.audit().minRetention().toSeconds();
        return Math.max(1, (seconds + SECONDS_PER_DAY - 1) / SECONDS_PER_DAY);
    }

    private AuditRetentionView view(Integer days) {
        long minimum = minimumDays();
        return new AuditRetentionView(days, minimum, days == null ? null : Math.max(days, minimum));
    }

    private List<AuditEvent> entries(Optional<UUID> organization, long after) {
        String jpql = organization.isPresent()
                ? "from AuditEvent e where e.organizationId = :organization and e.chainIndex > :after"
                : "from AuditEvent e where e.organizationId is null and e.chainIndex > :after";
        TypedQuery<AuditEvent> query = entityManager
                .createQuery(jpql + " order by e.chainIndex", AuditEvent.class)
                .setParameter("after", after)
                .setMaxResults(VERIFY_BATCH);
        organization.ifPresent(id -> query.setParameter("organization", id));
        return query.getResultList();
    }

    /** The head of a chain, created if needed and locked until the end of the transaction. */
    private Head lock(UUID chain) {
        entityManager
                .createNativeQuery(
                        "insert into {h-schema}audit_chain (chain_id, last_index, last_hash, anchor_index, anchor_hash)"
                                + " values (:chain, 0, :genesis, 0, :genesis) on conflict (chain_id) do nothing")
                .setParameter("chain", chain)
                .setParameter("genesis", AuditChain.GENESIS)
                .executeUpdate();
        return head(chain, true).orElseThrow();
    }

    private Optional<Head> head(UUID chain, boolean forUpdate) {
        List<?> rows = entityManager
                .createNativeQuery("select last_index, last_hash, anchor_index, anchor_hash, retention_days"
                        + " from {h-schema}audit_chain where chain_id = :chain" + (forUpdate ? " for update" : ""))
                .setParameter("chain", chain)
                .getResultList();
        return rows.stream()
                .findFirst()
                .map(Object[].class::cast)
                .map(row -> new Head(
                        ((Number) row[0]).longValue(),
                        (String) row[1],
                        ((Number) row[2]).longValue(),
                        (String) row[3],
                        row[4] == null ? null : ((Number) row[4]).intValue()));
    }

    /** The head of a chain: its last entry, its anchor and its retention. */
    private record Head(long lastIndex, String lastHash, long anchorIndex, String anchorHash, Integer retentionDays) {}

    /**
     * Runs the rest of the transaction as the owner of the tables, not as the member role of the
     * request (ADR-0018): the kernel writes the entries of every organization and of the platform, and
     * filters its own queries.
     */
    private void asOwner() {
        entityManager
                .createNativeQuery("select set_config('role', 'none', true)")
                .getSingleResult();
    }

    private static AuditEvent.Channel currentChannel() {
        ArcContainer container = Arc.container();
        if (container == null || !container.requestContext().isActive()) {
            return AuditEvent.Channel.JOB;
        }
        return withAccessKey(container) ? AuditEvent.Channel.API_KEY : AuditEvent.Channel.WEB;
    }

    /**
     * Whether the HTTP request of the current context was authenticated with a personal access key
     * (MK-060): read from the identity already set on the request, so that nothing is authenticated
     * again here.
     */
    private static boolean withAccessKey(ArcContainer container) {
        InstanceHandle<CurrentVertxRequest> request = container.instance(CurrentVertxRequest.class);
        RoutingContext routing = request.isAvailable() ? request.get().getCurrent() : null;
        return routing != null
                && routing.user() instanceof QuarkusHttpUser user
                && user.getSecurityIdentity().getAttribute(AccessKeyRegistry.ATTRIBUTE) != null;
    }

    private String write(Map<String, ?> detail) {
        if (detail == null || detail.isEmpty()) {
            return null;
        }
        try {
            return json.writeValueAsString(detail);
        } catch (JsonProcessingException _) {
            return String.valueOf(detail);
        }
    }
}
