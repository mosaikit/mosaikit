// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.data.exceptions.OptimisticLockingFailureException;
import jakarta.enterprise.context.ApplicationScoped;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * Runs the tools of plugins on behalf of a person (MK-015). A tool that reads runs at once; a tool
 * that writes or executes becomes a draft, which runs only when the same person confirms it within
 * {@link #DRAFT_LIFETIME}. Every run, proposal and decision goes to the audit log.
 */
@ApplicationScoped
public class AiActions {

    /** How long a person has to confirm a draft. */
    public static final Duration DRAFT_LIFETIME = Duration.ofMinutes(15);

    /** Longest answer of a plugin kept with a draft. */
    static final int MAX_RESULT = 65_536;

    private static final String DRAFT = "draft";

    static final String EXECUTED = "ai.action.executed";
    static final String PROPOSED = "ai.action.proposed";
    static final String CONFIRMED = "ai.action.confirmed";
    static final String REJECTED = "ai.action.rejected";

    private final ActionCatalog catalog;
    private final ActionDrafts drafts;
    private final ActionInvoker invoker;
    private final AuditLog audit;
    private final ObjectMapper json;
    private final Clock clock;

    public AiActions(
            ActionCatalog catalog,
            ActionDrafts drafts,
            ActionInvoker invoker,
            AuditLog audit,
            ObjectMapper json,
            Clock clock) {
        this.catalog = catalog;
        this.drafts = drafts;
        this.invoker = invoker;
        this.audit = audit;
        this.json = json;
        this.clock = clock;
    }

    /** The tools of the active plugins. */
    public List<AiTool> tools() {
        return catalog.tools();
    }

    /**
     * Invokes a tool: runs it if it only reads, otherwise keeps it as a draft for the person.
     *
     * @throws ResourceNotFoundException when no active plugin offers the tool
     * @throws dev.mosaikit.kernel.core.error.InvalidInputException when the arguments do not match
     *     the input schema of the tool
     */
    public Invocation invoke(String name, Object input, Caller caller) {
        AiTool tool = catalog.find(name)
                .orElseThrow(() -> new ResourceNotFoundException("No active plugin offers the tool " + name + "."));
        Map<String, Object> arguments = tool.arguments(input);
        tool.call(arguments);
        if (!tool.needsConfirmation()) {
            return Invocation.executed(run(tool, arguments, caller, EXECUTED, Map.of()), null);
        }
        Instant now = Instant.now(clock);
        ActionDraft draft = new ActionDraft(
                caller.username(),
                caller.organizationId(),
                tool.name(),
                write(arguments),
                now,
                now.plus(DRAFT_LIFETIME));
        inTransaction(() -> {
            drafts.insert(draft);
            return draft;
        });
        audit.append(
                caller.username(),
                Optional.of(caller.organizationId()),
                PROPOSED,
                tool.name(),
                AuditEvent.Outcome.SUCCEEDED,
                Map.of(DRAFT, draft.getId(), "input", arguments));
        return Invocation.drafted(view(draft, now));
    }

    /** The drafts that the person can still confirm, oldest first. */
    public List<DraftView> openDrafts(Caller caller) {
        Instant now = Instant.now(clock);
        return inTransaction(() ->
                drafts.findOpen(caller.username(), caller.organizationId(), ActionDraft.Status.PENDING, now).stream()
                        .map(draft -> view(draft, now))
                        .toList());
    }

    /** A draft of the person. */
    public DraftView draft(UUID id, Caller caller) {
        return inTransaction(() -> view(own(id, caller), Instant.now(clock)));
    }

    /**
     * Runs a draft that the person confirms.
     *
     * @throws ResourceNotFoundException when the person has no such draft
     * @throws ConflictException when the draft is no longer pending, or the tool no longer offered
     */
    public Invocation confirm(UUID id, Caller caller) {
        Instant now = Instant.now(clock);
        ActionDraft draft = decide(id, caller, now, ActionDraft::confirm);
        Optional<AiTool> tool = catalog.find(draft.getTool());
        if (tool.isEmpty()) {
            complete(draft, false, null, "No active plugin offers the tool any more.");
            audit.append(
                    caller.username(),
                    Optional.of(caller.organizationId()),
                    CONFIRMED,
                    draft.getTool(),
                    AuditEvent.Outcome.FAILED,
                    Map.of(DRAFT, id, "error", "tool not offered"));
            throw new ConflictException("No active plugin offers the tool " + draft.getTool() + " any more.");
        }
        Map<String, Object> arguments = tool.get().arguments(read(draft.getInput()));
        PluginResponse response;
        try {
            response = run(tool.get(), arguments, caller, CONFIRMED, Map.of(DRAFT, id));
        } catch (ServiceUnavailableException e) {
            complete(draft, false, null, e.getMessage());
            throw e;
        }
        ActionDraft completed = complete(draft, response.succeeded(), response.status(), write(response.body()));
        return Invocation.executed(response, view(completed, Instant.now(clock)));
    }

    /**
     * Discards a draft that the person rejects.
     *
     * @throws ResourceNotFoundException when the person has no such draft
     * @throws ConflictException when the draft is no longer pending
     */
    public DraftView reject(UUID id, Caller caller) {
        Instant now = Instant.now(clock);
        ActionDraft draft = decide(id, caller, now, ActionDraft::reject);
        audit.append(
                caller.username(),
                Optional.of(caller.organizationId()),
                REJECTED,
                draft.getTool(),
                AuditEvent.Outcome.SUCCEEDED,
                Map.of(DRAFT, id));
        return view(draft, now);
    }

    private interface Decision {
        void apply(ActionDraft draft, Instant now);
    }

    private ActionDraft decide(UUID id, Caller caller, Instant now, Decision decision) {
        try {
            return inTransaction(() -> {
                ActionDraft draft = own(id, caller);
                ActionDraft.Status status = draft.statusAt(now);
                if (status != ActionDraft.Status.PENDING) {
                    throw new ConflictException(
                            "The draft is " + status.name().toLowerCase(Locale.ROOT) + ": it cannot be decided again.");
                }
                decision.apply(draft, now);
                drafts.update(draft);
                return draft;
            });
        } catch (OptimisticLockingFailureException _) {
            throw new ConflictException("The draft was decided meanwhile.");
        }
    }

    private ActionDraft own(UUID id, Caller caller) {
        return drafts.findById(id)
                .filter(draft -> draft.belongsTo(caller.username(), caller.organizationId()))
                .orElseThrow(() -> new ResourceNotFoundException("You have no draft " + id + "."));
    }

    private ActionDraft complete(ActionDraft draft, boolean succeeded, Integer status, String answer) {
        return inTransaction(() -> {
            ActionDraft current = drafts.findById(draft.getId()).orElseThrow();
            current.complete(succeeded, status, truncate(answer));
            drafts.update(current);
            return current;
        });
    }

    private PluginResponse run(
            AiTool tool, Map<String, Object> arguments, Caller caller, String action, Map<String, ?> extra) {
        Map<String, Object> detail = new LinkedHashMap<>(extra);
        detail.put("input", arguments);
        PluginResponse response;
        try {
            response = invoker.invoke(tool.call(arguments), caller);
        } catch (RuntimeException e) {
            detail.put("error", String.valueOf(e.getMessage()));
            audit.append(
                    caller.username(),
                    Optional.of(caller.organizationId()),
                    action,
                    tool.name(),
                    AuditEvent.Outcome.FAILED,
                    detail);
            throw new ServiceUnavailableException("The plugin " + tool.plugin() + " did not answer; try again later.");
        }
        detail.put("status", response.status());
        audit.append(
                caller.username(),
                Optional.of(caller.organizationId()),
                action,
                tool.name(),
                response.succeeded() ? AuditEvent.Outcome.SUCCEEDED : AuditEvent.Outcome.FAILED,
                detail);
        return response;
    }

    private DraftView view(ActionDraft draft, Instant now) {
        Optional<AiTool> tool = catalog.find(draft.getTool());
        return new DraftView(
                draft.getId(),
                draft.getTool(),
                tool.map(found -> found.action().title()).orElse(draft.getTool()),
                tool.map(found -> found.action().description()).orElse(null),
                tool.map(found -> found.action().risk().value()).orElse(null),
                read(draft.getInput()),
                draft.statusAt(now).name().toLowerCase(Locale.ROOT),
                draft.getCreatedAt(),
                draft.getExpiresAt());
    }

    private static <T> T inTransaction(Supplier<T> work) {
        return QuarkusTransaction.requiringNew().call(work::get);
    }

    private String write(Object value) {
        try {
            return json.writeValueAsString(value);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Cannot write the value as JSON", e);
        }
    }

    private Object read(String value) {
        try {
            return json.readValue(value, Object.class);
        } catch (JsonProcessingException _) {
            return value;
        }
    }

    private static String truncate(String answer) {
        return answer == null || answer.length() <= MAX_RESULT ? answer : answer.substring(0, MAX_RESULT);
    }
}
