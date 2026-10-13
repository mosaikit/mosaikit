// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.audit.AuditLog;
import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.events.PlatformEvent;
import dev.mosaikit.kernel.api.events.PlatformEventSubscriber;
import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.api.resource.Resource;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.Resources;
import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.sql.SQLException;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Stands for the Java code of extensions that subscribe to events of the platform (MK-085): what each
 * subscriber received, in which organization it ran and what row-level security saw then.
 */
public final class EventSubscribersProbe {

    static final String EVENTS = PlatformEventsTest.EXTENSION;
    static final String BOARD = "dev.mosaikit.test.board";
    static final String NOTE_CREATED = EVENTS + ":note.created";
    static final String FLAKY = EVENTS + ":flaky.happened";
    static final ResourceRef INBOX = new ResourceRef(EVENTS, "folder", "inbox");

    private EventSubscribersProbe() {}

    /** A delivery as a subscriber saw it. */
    record Received(
            String subscriber,
            PlatformEvent event,
            UUID currentOrganization,
            String databaseOrganization,
            String databaseRole,
            Resource inbox) {}

    /** What the subscribers of the tests received, in order. */
    @ApplicationScoped
    public static class Recorder {

        private final List<Received> received = new CopyOnWriteArrayList<>();
        private volatile boolean flakyAvailable = true;

        void add(Received found) {
            received.add(found);
        }

        boolean flakyAvailable() {
            return flakyAvailable;
        }

        void flakyAvailable(boolean available) {
            flakyAvailable = available;
        }

        List<Received> of(String subscriber, String type) {
            return received.stream()
                    .filter(found -> found.subscriber().equals(subscriber)
                            && found.event().type().equals(type))
                    .toList();
        }
    }

    /** What every subscriber records: the organization of its context and of its connection. */
    abstract static class Recording implements PlatformEventSubscriber {

        @Inject
        Recorder recorder;

        @Inject
        CurrentOrganization organization;

        @Inject
        AgroalDataSource dataSource;

        void record(PlatformEvent event, Resource inbox) throws SQLException {
            try (var connection = dataSource.getConnection();
                    var statement = connection.createStatement();
                    var result = statement.executeQuery(
                            "select mk_kernel.current_organization()::text, current_user::text")) {
                result.next();
                recorder.add(new Received(
                        extension() + "/" + name(),
                        event,
                        organization.id().orElse(null),
                        result.getString(1),
                        result.getString(2),
                        inbox));
            }
        }
    }

    /**
     * The subscriber of the extension of the tests: on a new organization it registers its inbox and
     * records it in the audit log, as an extension that prepares an organization does.
     */
    @ApplicationScoped
    public static class Prepare extends Recording {

        @Inject
        Resources resources;

        @Inject
        AuditLog audit;

        @Override
        public String extension() {
            return EVENTS;
        }

        @Override
        public Set<String> types() {
            return Set.of(
                    PlatformEvents.ORGANIZATION_CREATED,
                    PlatformEvents.EXTENSION_DISABLED,
                    PlatformEvents.EXTENSION_ENABLED,
                    PlatformEvents.FILE_STORED,
                    PlatformEvents.RESOURCE_REGISTERED,
                    NOTE_CREATED);
        }

        @Override
        public void handle(PlatformEvent event) throws SQLException {
            Resource inbox = null;
            // Only in the organizations of PlatformEventsTest: the other tests share this kernel.
            if (event.type().equals(PlatformEvents.ORGANIZATION_CREATED)
                    && event.text("slug").startsWith(PlatformEventsTest.PREFIX)) {
                inbox = resources.register(INBOX, Resources.Details.of("Inbox", "/app/events/inbox"));
                audit.record(EVENTS, AuditLog.Entry.of("inbox.prepared", "folder/inbox"));
            }
            record(event, inbox);
        }
    }

    /** A subscriber that fails while it is not available, as one whose service is down. */
    @ApplicationScoped
    public static class Flaky extends Recording {

        @Override
        public String extension() {
            return EVENTS;
        }

        @Override
        public String name() {
            return "flaky";
        }

        @Override
        public Set<String> types() {
            return Set.of(FLAKY);
        }

        @Override
        public void handle(PlatformEvent event) throws SQLException {
            if (!recorder.flakyAvailable()) {
                throw new IllegalStateException("not available");
            }
            record(event, null);
        }
    }

    /** A subscriber of the board extension, which an organization turns off (MK-030). */
    @ApplicationScoped
    public static class Board extends Recording {

        @Override
        public String extension() {
            return BOARD;
        }

        @Override
        public Set<String> types() {
            return Set.of(PlatformEvents.EXTENSION_DISABLED, PlatformEvents.EXTENSION_ENABLED, NOTE_CREATED);
        }

        @Override
        public void handle(PlatformEvent event) throws SQLException {
            record(event, null);
        }
    }
}
