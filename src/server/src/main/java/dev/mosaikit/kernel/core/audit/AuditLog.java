// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.data.Limit;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.jboss.logging.Logger;

/**
 * The audit log of the installation. Each event is written in its own transaction, so that it is
 * kept even when the operation it records fails, and to the {@code mosaikit.audit} log category,
 * so that it can be sent to a SIEM.
 */
@ApplicationScoped
public class AuditLog {

    /** Most events returned by one query. */
    public static final int MAX_EVENTS = 500;

    private static final Logger LOG = Logger.getLogger("mosaikit.audit");

    private final AuditEvents events;
    private final ObjectMapper json;
    private final Clock clock;

    public AuditLog(AuditEvents events, ObjectMapper json, Clock clock) {
        this.events = events;
        this.json = json;
        this.clock = clock;
    }

    /** Records an event. */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public void append(
            String actor,
            Optional<UUID> organization,
            String action,
            String subject,
            AuditEvent.Outcome outcome,
            Map<String, ?> detail) {
        String details = write(detail);
        events.insert(new AuditEvent(
                Instant.now(clock), actor, organization.orElse(null), action, subject, outcome, details));
        LOG.infof(
                "%s %s by %s in %s on %s: %s",
                action, outcome, actor, organization.map(UUID::toString).orElse("-"), subject, details);
    }

    /** The latest events, newest first; of one organization when given. */
    @Transactional
    public List<AuditEvent> latest(Optional<UUID> organization, int limit) {
        Limit bounded = Limit.of(Math.clamp(limit, 1, MAX_EVENTS));
        return organization.map(id -> events.latestOf(id, bounded)).orElseGet(() -> events.latest(bounded));
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
