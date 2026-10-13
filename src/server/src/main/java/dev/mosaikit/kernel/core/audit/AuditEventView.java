// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.UUID;

/** An audit event as returned by the API. */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AuditEventView(
        UUID id,
        Instant occurredAt,
        String actor,
        UUID organizationId,
        String action,
        String subject,
        AuditEvent.Outcome outcome,
        String detail) {

    static AuditEventView of(AuditEvent event) {
        return new AuditEventView(
                event.getId(),
                event.getOccurredAt(),
                event.getActor(),
                event.getOrganizationId().orElse(null),
                event.getAction(),
                event.getSubject().orElse(null),
                event.getOutcome(),
                event.getDetail().orElse(null));
    }
}
