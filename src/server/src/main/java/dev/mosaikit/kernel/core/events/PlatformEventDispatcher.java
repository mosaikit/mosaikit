// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.events;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.api.events.PlatformEvent;
import dev.mosaikit.kernel.api.events.PlatformEventSubscriber;
import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.core.apps.AppSettings;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.events.PlatformEventStore.Due;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.jobs.OrganizationJobs;
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import java.io.IOException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.jboss.logging.Logger;

/**
 * Hands the events of the platform to their subscribers (MK-085). Every kernel of the installation
 * looks for due deliveries every {@code mosaikit.events.poll-interval}, claims some for a lease and
 * hands each to its subscriber in the organization of its event, without a person
 * ({@link OrganizationJobs}, MK-126); then marks it delivered, or retries it later, waiting twice as
 * long each time, and gives it up after the most attempts, in the audit log. A delivery whose
 * subscriber the kernel does not have now, such as an extension being updated, is retried the same
 * way; one of an extension that the organization turned off is skipped, except the event that turns
 * that extension off or on.
 */
@ApplicationScoped
public class PlatformEventDispatcher {

    private static final Logger LOG = Logger.getLogger(PlatformEventDispatcher.class);

    /** Deliveries claimed at a time. */
    static final int BATCH = 50;

    /**
     * How long a claim lasts: a delivery whose kernel stopped before marking it is given again after
     * it. A handler that takes longer may then run twice, which at-least-once delivery allows.
     */
    static final Duration LEASE = Duration.ofMinutes(5);

    /** The longest wait between two attempts. */
    static final Duration MAX_DELAY = Duration.ofHours(1);

    /** Rounds of claims at most in one run, so that one run ends. */
    private static final int MAX_ROUNDS = 20;

    private static final Set<String> ABOUT_AN_EXTENSION = Set.of(
            PlatformEvents.EXTENSION_ENABLED,
            PlatformEvents.EXTENSION_DISABLED,
            PlatformEvents.EXTENSION_ACTIVATED,
            PlatformEvents.EXTENSION_DEACTIVATED);

    private final PlatformEventStore store;
    private final EventSubscribers subscribers;
    private final ExtensionRegistry extensions;
    private final AppSettings apps;
    private final OrganizationJobs jobs;
    private final AuditLog audit;
    private final ObjectMapper json;
    private final KernelConfig config;
    private final Clock clock;

    public PlatformEventDispatcher(
            PlatformEventStore store,
            EventSubscribers subscribers,
            ExtensionRegistry extensions,
            AppSettings apps,
            OrganizationJobs jobs,
            AuditLog audit,
            ObjectMapper json,
            KernelConfig config,
            Clock clock) {
        this.store = store;
        this.subscribers = subscribers;
        this.extensions = extensions;
        this.apps = apps;
        this.jobs = jobs;
        this.audit = audit;
        this.json = json;
        this.config = config;
        this.clock = clock;
    }

    @Scheduled(
            identity = "mosaikit-platform-events",
            every = "${mosaikit.events.poll-interval:2s}",
            delayed = "5s",
            concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void run() {
        try {
            // The scheduler opens a request context without organization: deliveries take their own.
            OrganizationJobs.outsideRequests(() -> dispatch(Instant.now(clock)));
        } catch (Exception e) {
            LOG.warnf(e, "Cannot deliver the events of the platform now; trying again at the next run");
        }
    }

    @Scheduled(
            identity = "mosaikit-platform-events-prune",
            every = "1h",
            delayed = "10m",
            concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void prune() {
        try {
            OrganizationJobs.outsideRequests(
                    () -> store.prune(Instant.now(clock).minus(config.events().keep())));
        } catch (Exception e) {
            LOG.warnf(e, "Cannot delete the events of the platform already delivered; trying again later");
        }
    }

    /** Hands the deliveries due at {@code now}; returns how many were delivered. */
    public int dispatch(Instant now) {
        int delivered = 0;
        for (int round = 0; round < MAX_ROUNDS; round++) {
            List<Due> due = store.claim(now, BATCH, now.plus(LEASE));
            for (Due delivery : due) {
                if (deliver(delivery, now)) {
                    delivered++;
                }
            }
            if (due.size() < BATCH) {
                break;
            }
        }
        return delivered;
    }

    private boolean deliver(Due due, Instant now) {
        String extension = EventSubscribers.extensionOf(due.subscriber());
        Optional<PlatformEventSubscriber> subscriber = subscribers.find(due.subscriber());
        if (subscriber.isEmpty() || extensions.findActive(extension).isEmpty()) {
            failed(due, now, "The subscriber is not available");
            return false;
        }
        if (turnedOff(due, extension)) {
            store.giveUp(due, now, "Skipped: the organization turned the extension off");
            return false;
        }
        try {
            PlatformEvent event = new PlatformEvent(
                    due.event(),
                    due.organization(),
                    due.type(),
                    due.source(),
                    read(due.payload()),
                    due.occurredAt(),
                    due.attempt());
            jobs.run(extension, due.organization(), () -> {
                subscriber.get().handle(event);
                return null;
            });
        } catch (Exception e) {
            failed(due, now, e.getClass().getSimpleName() + ": " + e.getMessage());
            return false;
        }
        store.delivered(due, Instant.now(clock));
        return true;
    }

    /** Whether the organization turned the extension off, unless the event is about that very extension. */
    private boolean turnedOff(Due due, String extension) {
        if (ABOUT_AN_EXTENSION.contains(due.type()) && PlatformEvents.KERNEL.equals(due.source())) {
            Map<String, Object> payload = read(due.payload());
            if (extension.equals(payload.get("extension"))) {
                return false;
            }
        }
        return apps.isOff(due.organization(), extension);
    }

    private void failed(Due due, Instant now, String error) {
        if (due.attempt() >= config.events().maxAttempts()) {
            LOG.errorf(
                    "Gave up the event %d (%s) for %s after %d attempts: %s",
                    due.event(), due.type(), due.subscriber(), due.attempt(), error);
            store.giveUp(due, now, error);
            Map<String, Object> detail = new LinkedHashMap<>();
            detail.put("event", due.event());
            detail.put("type", due.type());
            detail.put("attempts", due.attempt());
            detail.put("error", error);
            audit.append(
                    AuditEvent.Channel.JOB,
                    EventSubscribers.extensionOf(due.subscriber()),
                    Optional.of(due.organization()),
                    "events.delivery.failed",
                    due.subscriber(),
                    AuditEvent.Outcome.FAILED,
                    detail);
            return;
        }
        LOG.warnf(
                "The event %d (%s) failed for %s at attempt %d, retried later: %s",
                due.event(), due.type(), due.subscriber(), due.attempt(), error);
        store.retry(due, now.plus(delay(config.events().retryDelay(), due.attempt())), error);
    }

    /** The wait after the given attempt: the first delay, twice as long after each attempt, at most an hour. */
    static Duration delay(Duration first, int attempt) {
        Duration delay = first;
        for (int i = 1; i < attempt && delay.compareTo(MAX_DELAY) < 0; i++) {
            delay = delay.multipliedBy(2);
        }
        return delay.compareTo(MAX_DELAY) > 0 ? MAX_DELAY : delay;
    }

    private Map<String, Object> read(String payload) {
        try {
            return json.readValue(payload, new TypeReference<Map<String, Object>>() {});
        } catch (IOException e) {
            throw new IllegalStateException("The payload of an event is not JSON", e);
        }
    }
}
