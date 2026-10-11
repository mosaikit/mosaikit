// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * A tool that changes data or has effects, proposed by an assistant and waiting for the person to
 * confirm or reject it (MK-015). Only the person who proposed it, in the same organization, sees
 * and decides it.
 */
@Entity
@Table(name = "ai_action_draft")
public class ActionDraft {

    /** Where the draft stands. {@link #EXPIRED} is never stored: a pending draft expires by itself. */
    public enum Status {
        PENDING,
        CONFIRMED,
        EXECUTED,
        FAILED,
        REJECTED,
        EXPIRED
    }

    @Id
    private UUID id;

    @Column(nullable = false)
    private String username;

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    @Column(nullable = false)
    private String tool;

    /** Arguments, as JSON. */
    @Column(nullable = false)
    private String input;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Status status;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "decided_at")
    private Instant decidedAt;

    @Column(name = "result_status")
    private Integer resultStatus;

    /** What the plugin answered, as JSON. */
    private String result;

    /** Keeps two confirmations of one draft from both running it. */
    @Version
    private int version;

    /** Required by JPA. */
    protected ActionDraft() {}

    public ActionDraft(
            String username, UUID organizationId, String tool, String input, Instant createdAt, Instant expiresAt) {
        this.id = UUID.randomUUID();
        this.username = Objects.requireNonNull(username, "username");
        this.organizationId = Objects.requireNonNull(organizationId, "organizationId");
        this.tool = Objects.requireNonNull(tool, "tool");
        this.input = Objects.requireNonNull(input, "input");
        this.status = Status.PENDING;
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
        this.expiresAt = Objects.requireNonNull(expiresAt, "expiresAt");
    }

    public UUID getId() {
        return id;
    }

    /** Whether the draft belongs to this person in this organization. */
    public boolean belongsTo(String person, UUID organization) {
        return username.equals(person) && organizationId.equals(organization);
    }

    public String getTool() {
        return tool;
    }

    public String getInput() {
        return input;
    }

    /** The status at that instant, {@link Status#EXPIRED} for a pending draft past its expiry. */
    public Status statusAt(Instant now) {
        return status == Status.PENDING && !now.isBefore(expiresAt) ? Status.EXPIRED : status;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Optional<Instant> getDecidedAt() {
        return Optional.ofNullable(decidedAt);
    }

    public Optional<Integer> getResultStatus() {
        return Optional.ofNullable(resultStatus);
    }

    public Optional<String> getResult() {
        return Optional.ofNullable(result);
    }

    /** The person confirmed the draft: it runs now. */
    void confirm(Instant now) {
        decide(Status.CONFIRMED, now);
    }

    /** The person rejected the draft: it never runs. */
    void reject(Instant now) {
        decide(Status.REJECTED, now);
    }

    /** Records what the plugin answered. */
    void complete(boolean succeeded, Integer answeredStatus, String answer) {
        if (status != Status.CONFIRMED) {
            throw new IllegalStateException("Draft " + id + " is " + status + ", not confirmed");
        }
        this.status = succeeded ? Status.EXECUTED : Status.FAILED;
        this.resultStatus = answeredStatus;
        this.result = answer;
    }

    private void decide(Status decision, Instant now) {
        if (statusAt(now) != Status.PENDING) {
            throw new IllegalStateException("Draft " + id + " is " + statusAt(now) + ", not pending");
        }
        this.status = decision;
        this.decidedAt = now;
    }
}
