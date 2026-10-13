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

/**
 * Something a person, a job, an assistant or an extension did, or tried to do, that the installation
 * keeps a trace of. Never changes. Each entry is chained to the one before it in the chain of its
 * organization, or of the platform (MK-059): see {@link AuditChain}.
 */
@Entity
@Table(name = "audit_event")
public class AuditEvent {

    /** How the attempt ended. */
    public enum Outcome {
        SUCCEEDED,
        FAILED,
        DENIED
    }

    /** Through which channel the action came (MK-059). */
    public enum Channel {
        /** A person in the console, or a client signed in as a person. */
        WEB,
        /** A client authenticated with an API key. */
        API_KEY,
        /** A scheduled or background job of the kernel, outside any request. */
        JOB,
        /** An assistant or an MCP client acting on behalf of a person. */
        ASSISTANT,
        /** The Java code of an extension, through kernel-api. */
        EXTENSION,
        /** A service identity (MK-124): an internal caller that is not a person, with a key of its own. */
        SERVICE
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

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Channel channel;

    /** Stable name of what was done, for example {@code ai.action.confirmed}. */
    @Column(nullable = false)
    private String action;

    /** What it was done to, the object of the action, for example the name of a tool. */
    private String subject;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private Outcome outcome;

    /** Details, as JSON. */
    private String detail;

    /** Position in the chain, from 1. */
    @Column(name = "chain_index", nullable = false)
    private long chainIndex;

    @Column(name = "previous_hash", nullable = false)
    private String previousHash;

    @Column(nullable = false)
    private String hash;

    /** Required by JPA. */
    protected AuditEvent() {}

    AuditEvent(
            Instant occurredAt,
            String actor,
            UUID organizationId,
            Channel channel,
            String action,
            String subject,
            Outcome outcome,
            String detail) {
        this.id = UUID.randomUUID();
        this.occurredAt = Objects.requireNonNull(occurredAt, "occurredAt");
        this.actor = Objects.requireNonNull(actor, "actor");
        this.organizationId = organizationId;
        this.channel = Objects.requireNonNull(channel, "channel");
        this.action = Objects.requireNonNull(action, "action");
        this.subject = subject;
        this.outcome = Objects.requireNonNull(outcome, "outcome");
        this.detail = detail;
    }

    /** Puts the entry at its place in the chain, after the entry whose hash is given. */
    void chain(long index, String previous) {
        this.chainIndex = index;
        this.previousHash = Objects.requireNonNull(previous, "previous");
        this.hash = AuditChain.hash(this);
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

    public Channel getChannel() {
        return channel;
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

    public long getChainIndex() {
        return chainIndex;
    }

    public String getPreviousHash() {
        return previousHash;
    }

    public String getHash() {
        return hash;
    }
}
