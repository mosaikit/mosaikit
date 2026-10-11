// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/** Something a person did, or tried to do, that the installation keeps a trace of. Never changes. */
@Entity
@Table(name = "audit_event")
public class AuditEvent {

    /** How the attempt ended. */
    public enum Outcome {
        SUCCEEDED,
        FAILED,
        DENIED
    }

    @Id
    private UUID id;

    @Column(name = "occurred_at", nullable = false)
    private Instant occurredAt;

    /** Username of the person, or {@code system}. */
    @Column(nullable = false)
    private String actor;

    @Column(name = "organization_id")
    private UUID organizationId;

    /** Stable name of what was done, for example {@code ai.action.confirmed}. */
    @Column(nullable = false)
    private String action;

    /** What it was done to, for example the name of a tool. */
    private String subject;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Outcome outcome;

    /** Details, as JSON. */
    private String detail;

    /** Required by JPA. */
    protected AuditEvent() {}

    public AuditEvent(
            Instant occurredAt,
            String actor,
            UUID organizationId,
            String action,
            String subject,
            Outcome outcome,
            String detail) {
        this.id = UUID.randomUUID();
        this.occurredAt = Objects.requireNonNull(occurredAt, "occurredAt");
        this.actor = Objects.requireNonNull(actor, "actor");
        this.organizationId = organizationId;
        this.action = Objects.requireNonNull(action, "action");
        this.subject = subject;
        this.outcome = Objects.requireNonNull(outcome, "outcome");
        this.detail = detail;
    }

    public UUID getId() {
        return id;
    }

    public Instant getOccurredAt() {
        return occurredAt;
    }

    public String getActor() {
        return actor;
    }

    public Optional<UUID> getOrganizationId() {
        return Optional.ofNullable(organizationId);
    }

    public String getAction() {
        return action;
    }

    public Optional<String> getSubject() {
        return Optional.ofNullable(subject);
    }

    public Outcome getOutcome() {
        return outcome;
    }

    public Optional<String> getDetail() {
        return Optional.ofNullable(detail);
    }
}
