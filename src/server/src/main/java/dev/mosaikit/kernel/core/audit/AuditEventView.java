// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.UUID;

/** An audit event as returned by the API, with its place in its chain (MK-059). */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AuditEventView(
        UUID id,
        Instant occurredAt,
        String actor,
        UUID organizationId,
        AuditEvent.Channel channel,
        String action,
        String subject,
        AuditEvent.Outcome outcome,
        String detail,
        long index,
        String previousHash,
        String hash) {

    static AuditEventView of(AuditEvent event) {
        return new AuditEventView(
                event.getId(),
                event.getOccurredAt(),
                event.getActor(),
                event.getOrganizationId().orElse(null),
                event.getChannel(),
                event.getAction(),
                event.getSubject().orElse(null),
                event.getOutcome(),
                event.getDetail().orElse(null),
                event.getChainIndex(),
                event.getPreviousHash(),
                event.getHash());
    }
}
