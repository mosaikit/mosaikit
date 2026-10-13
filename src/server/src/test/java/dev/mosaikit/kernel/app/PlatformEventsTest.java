// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.EventSubscribersProbe.BOARD;
import static dev.mosaikit.kernel.app.EventSubscribersProbe.FLAKY;
import static dev.mosaikit.kernel.app.EventSubscribersProbe.INBOX;
import static dev.mosaikit.kernel.app.EventSubscribersProbe.NOTE_CREATED;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.app.EventSubscribersProbe.Received;
import dev.mosaikit.kernel.app.EventSubscribersProbe.Recorder;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.audit.AuditQuery;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.events.PlatformEventDispatcher;
import dev.mosaikit.kernel.core.events.PlatformEventStore;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Predicate;
import java.util.function.Supplier;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Events of the platform for the Java code of extensions (MK-085): a subscriber is called once for
 * each event of its types with its payload, in the organization of the event only, without a person
 * (MK-126), and an event raised while it fails reaches it when it is back. The kernel raises events
 * for a new organization and for an extension turned off or on.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-085")
class PlatformEventsTest {

    static final String EXTENSION = "dev.mosaikit.test.events";
    static final String PREFIX = "events";
    static final String PREPARE = EXTENSION + "/default";
    static final String FLAKY_SUBSCRIBER = EXTENSION + "/flaky";
    static final String BOARD_SUBSCRIBER = BOARD + "/default";
    static final String TODO = "dev.mosaikit.test.todo";
    static final String PASSWORD = "a long enough password";
    static final Duration WAIT = Duration.ofSeconds(30);

    @Inject
    PlatformEventDispatcher dispatcher;

    @Inject
    PlatformEventStore store;

    @Inject
    Recorder recorder;

    @Inject
    AuditLog audit;

    @Inject
    KernelConfig config;

    @Inject
    AgroalDataSource dataSource;

    private static String organization() {
        String slug = unique(PREFIX);
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static UUID id(String slug) {
        return UUID.fromString(
                asAdmin().get("/api/v1/organizations/{slug}", slug).path("id"));
    }

    private static String person(String organization) {
        String email = unique("events") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    private static void raise(String person, String organization, String name, Map<String, Object> payload) {
        in(person, organization)
                .body(payload)
                .post("/api/v1/test/events/{extension}/{name}", EXTENSION, name)
                .then()
                .statusCode(204);
    }

    private static void apps(String organization, boolean board) {
        asAdmin()
                .body(List.of(
                        Map.of(
                                "extensionId",
                                TODO,
                                "appId",
                                "todo",
                                "enabled",
                                true,
                                "pinned",
                                false,
                                "roles",
                                List.of()),
                        Map.of(
                                "extensionId",
                                BOARD,
                                "appId",
                                "board",
                                "enabled",
                                board,
                                "pinned",
                                false,
                                "roles",
                                List.of())))
                .put("/api/v1/organizations/{slug}/apps", organization)
                .then()
                .statusCode(200);
    }

    /** Runs outside the context of the test, as the scheduler of the kernel does. */
    private static <T> T outside(Supplier<T> work) {
        return CompletableFuture.supplyAsync(work).join();
    }

    private int dispatch(Instant now) {
        return outside(() -> dispatcher.dispatch(now));
    }

    /** Delivers what is due until a subscriber received a matching event of a type. */
    private Received await(String subscriber, String type, Predicate<Received> match) {
        Instant end = Instant.now().plus(WAIT);
        while (Instant.now().isBefore(end)) {
            dispatch(Instant.now());
            Optional<Received> found =
                    recorder.of(subscriber, type).stream().filter(match).findFirst();
            if (found.isPresent()) {
                return found.get();
            }
            pause();
        }
        return fail("%s received no matching %s within %s", subscriber, type, WAIT);
    }

    private List<Received> received(String subscriber, String type, Predicate<Received> match) {
        return recorder.of(subscriber, type).stream().filter(match).toList();
    }

    private static Predicate<Received> in(UUID organization) {
        return found -> found.event().organization().equals(organization);
    }

    private static Predicate<Received> with(String name, Object value) {
        return found -> value.equals(found.event().payload().get(name));
    }

    /** The identifier of the event of a type whose payload holds a value, read as the kernel does. */
    private long eventId(String type, String value) {
        return outside(() -> {
            try (var connection = dataSource.getConnection();
                    var statement = connection.prepareStatement(
                            "select id from mk_kernel.platform_event where type = ? and position(? in payload) > 0")) {
                statement.setString(1, type);
                statement.setString(2, value);
                try (var result = statement.executeQuery()) {
                    assertThat(result.next())
                            .as("the event %s %s was written", type, value)
                            .isTrue();
                    return result.getLong(1);
                }
            } catch (SQLException e) {
                throw new IllegalStateException(e);
            }
        });
    }

    private static void pause() {
        try {
            Thread.sleep(100);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(e);
        }
    }

    @Test
    void aNewOrganizationReachesTheSubscriberWhichPreparesItWithoutAPerson() {
        String slug = organization();
        UUID organization = id(slug);

        Received created = await(PREPARE, PlatformEvents.ORGANIZATION_CREATED, in(organization));

        assertThat(created.event().source()).isEqualTo(PlatformEvents.KERNEL);
        assertThat(created.event().text("slug")).isEqualTo(slug);
        assertThat(created.event().attempt()).isEqualTo(1);
        // The handler acts on the organization of the event, under its row-level security.
        assertThat(created.currentOrganization()).isEqualTo(organization);
        assertThat(created.databaseOrganization()).isEqualTo(organization.toString());
        assertThat(created.databaseRole()).startsWith("mk_").endsWith("_member");
        // What it registers belongs to the organization, not to a person (MK-126).
        assertThat(created.inbox().organization()).isEqualTo(organization);
        assertThat(created.inbox().ownedByOrganization()).isTrue();
        // And the audit log records the extension as actor, through the channel JOB.
        List<AuditEvent> entries = audit.search(new AuditQuery(
                Optional.of(organization), false, null, EXTENSION + ":inbox.prepared", null, null, null, null, 0, 10));
        assertThat(entries).singleElement().satisfies(entry -> {
            assertThat(entry.getActor()).isEqualTo(EXTENSION);
            assertThat(entry.getChannel()).isEqualTo(AuditEvent.Channel.JOB);
        });
        // The registration raised an event of its own, delivered in the same organization.
        Received registered = await(PREPARE, PlatformEvents.RESOURCE_REGISTERED, in(organization));
        assertThat(registered.event().payload())
                .containsEntry("extension", EXTENSION)
                .containsEntry("type", INBOX.type())
                .containsEntry("id", INBOX.id())
                .doesNotContainKey("owner");
    }

    @Test
    void aFileStoredInAFolderReachesTheSubscriberWithItsFolder() {
        String slug = organization();
        UUID organization = id(slug);
        String bea = person(slug);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", slug, bea)
                .then()
                .statusCode(200);
        await(PREPARE, PlatformEvents.ORGANIZATION_CREATED, in(organization));

        String id = in(bea, slug)
                .contentType("text/plain")
                .body("plans")
                .post("/api/v1/test/files/{extension}?name=plan.txt&resource=folder/inbox", EXTENSION)
                .then()
                .statusCode(200)
                .extract()
                .path("id");

        Received stored =
                await(PREPARE, PlatformEvents.FILE_STORED, in(organization).and(with("file", id)));
        assertThat(stored.event().payload())
                .containsEntry("extension", EXTENSION)
                .containsEntry("name", "plan.txt")
                .containsEntry("resource", INBOX.toString())
                .containsEntry("size", 5);
        assertThat(stored.currentOrganization()).isEqualTo(organization);
    }

    @Test
    void eachMatchingEventReachesTheSubscriberOnceWithItsPayload() {
        String slug = organization();
        UUID organization = id(slug);
        String ada = person(slug);

        raise(ada, slug, "note.created", Map.of("note", "n1", "folder", "plans"));
        raise(ada, slug, "note.created", Map.of("note", "n2"));
        raise(ada, slug, "note.archived", Map.of("note", "n1"));

        Received first = await(PREPARE, NOTE_CREATED, in(organization).and(with("note", "n1")));
        await(PREPARE, NOTE_CREATED, in(organization).and(with("note", "n2")));
        dispatch(Instant.now());
        dispatch(Instant.now().plus(Duration.ofDays(1)));

        assertThat(first.event().source()).isEqualTo(EXTENSION);
        assertThat(first.event().payload()).containsEntry("folder", "plans");
        assertThat(received(PREPARE, NOTE_CREATED, in(organization)))
                .extracting(found -> found.event().text("note"))
                .containsExactlyInAnyOrder("n1", "n2");
        assertThat(received(PREPARE, EXTENSION + ":note.archived", found -> true))
                .isEmpty();

        // A name that is not valid, or an extension that is not active, raises nothing.
        in(ada, slug)
                .body(Map.of())
                .post("/api/v1/test/events/{extension}/{name}", EXTENSION, "Not Valid")
                .then()
                .statusCode(400);
        in(ada, slug)
                .body(Map.of())
                .post("/api/v1/test/events/{extension}/{name}", "dev.mosaikit.test.nowhere", "note.created")
                .then()
                .statusCode(400);
    }

    @Test
    void eventsAreDeliveredOnlyInTheOrganizationWhereTheyHappened() {
        String acme = organization();
        String globex = organization();
        UUID acmeId = id(acme);
        UUID globexId = id(globex);
        String ada = person(acme);
        String cleo = person(globex);

        raise(ada, acme, "note.created", Map.of("note", "acme-1"));
        raise(cleo, globex, "note.created", Map.of("note", "globex-1"));

        Received ofAcme = await(PREPARE, NOTE_CREATED, with("note", "acme-1"));
        Received ofGlobex = await(PREPARE, NOTE_CREATED, with("note", "globex-1"));
        assertThat(ofAcme.event().organization()).isEqualTo(acmeId);
        assertThat(ofAcme.currentOrganization()).isEqualTo(acmeId);
        assertThat(ofAcme.databaseOrganization()).isEqualTo(acmeId.toString());
        assertThat(ofGlobex.event().organization()).isEqualTo(globexId);
        assertThat(ofGlobex.currentOrganization()).isEqualTo(globexId);
        assertThat(ofGlobex.databaseOrganization()).isEqualTo(globexId.toString());

        // Globex turns the board off: its subscriber hears it, and no longer the events of Globex.
        apps(globex, false);
        Received off = await(BOARD_SUBSCRIBER, PlatformEvents.EXTENSION_DISABLED, in(globexId));
        assertThat(off.event().text("extension")).isEqualTo(BOARD);
        assertThat(off.currentOrganization()).isEqualTo(globexId);

        raise(cleo, globex, "note.created", Map.of("note", "globex-2"));
        raise(ada, acme, "note.created", Map.of("note", "acme-2"));
        await(BOARD_SUBSCRIBER, NOTE_CREATED, with("note", "acme-2"));
        await(PREPARE, NOTE_CREATED, with("note", "globex-2"));
        dispatch(Instant.now().plus(Duration.ofDays(1)));
        assertThat(received(BOARD_SUBSCRIBER, NOTE_CREATED, with("note", "globex-2")))
                .isEmpty();
        long skipped = eventId(NOTE_CREATED, "globex-2");
        assertThat(outside(() -> store.state(skipped, BOARD_SUBSCRIBER))).hasValueSatisfying(state -> {
            assertThat(state.delivered()).isFalse();
            assertThat(state.failed()).isTrue();
            assertThat(state.lastError()).contains("turned the extension off");
        });

        // Turned on again, it hears that too.
        apps(globex, true);
        Received on = await(BOARD_SUBSCRIBER, PlatformEvents.EXTENSION_ENABLED, in(globexId));
        assertThat(on.event().text("extension")).isEqualTo(BOARD);
        // Every delivery ran in the organization of its event, never in another.
        assertThat(recorder.of(BOARD_SUBSCRIBER, NOTE_CREATED))
                .allSatisfy(found -> assertThat(found.currentOrganization())
                        .isEqualTo(found.event().organization()));
    }

    @Test
    void anEventRaisedWhileTheSubscriberFailsIsDeliveredWhenItIsBack() {
        String slug = organization();
        UUID organization = id(slug);
        String ada = person(slug);
        String token = unique("flaky");
        recorder.flakyAvailable(false);
        try {
            raise(ada, slug, "flaky.happened", Map.of("token", token));
            long event = eventId(FLAKY, token);

            dispatch(Instant.now());
            assertThat(outside(() -> store.state(event, FLAKY_SUBSCRIBER))).hasValueSatisfying(state -> {
                assertThat(state.attempts()).isPositive();
                assertThat(state.delivered()).isFalse();
                assertThat(state.failed()).isFalse();
                assertThat(state.lastError()).contains("not available");
            });

            // Back, as after a restart: the event is in the database, and the next attempt delivers it.
            recorder.flakyAvailable(true);
            dispatch(Instant.now().plus(Duration.ofHours(2)));
        } finally {
            recorder.flakyAvailable(true);
        }
        Received delivered = await(FLAKY_SUBSCRIBER, FLAKY, with("token", token));
        assertThat(delivered.event().organization()).isEqualTo(organization);
        assertThat(delivered.event().attempt()).isGreaterThan(1);
        dispatch(Instant.now().plus(Duration.ofDays(1)));
        assertThat(received(FLAKY_SUBSCRIBER, FLAKY, with("token", token))).hasSize(1);
    }

    @Test
    void aDeliveryThatKeepsFailingIsGivenUpInTheAuditLog() {
        String slug = organization();
        UUID organization = id(slug);
        String ada = person(slug);
        String token = unique("given-up");
        recorder.flakyAvailable(false);
        try {
            raise(ada, slug, "flaky.happened", Map.of("token", token));
            long event = eventId(FLAKY, token);
            Instant now = Instant.now();
            for (int i = 0; i <= config.events().maxAttempts(); i++) {
                now = now.plus(Duration.ofHours(2));
                dispatch(now);
            }
            assertThat(outside(() -> store.state(event, FLAKY_SUBSCRIBER))).hasValueSatisfying(state -> {
                assertThat(state.failed()).isTrue();
                assertThat(state.attempts()).isEqualTo(config.events().maxAttempts());
            });
            recorder.flakyAvailable(true);
            dispatch(now.plus(Duration.ofDays(1)));
        } finally {
            recorder.flakyAvailable(true);
        }
        assertThat(received(FLAKY_SUBSCRIBER, FLAKY, with("token", token))).isEmpty();
        assertThat(audit.search(new AuditQuery(
                        Optional.of(organization),
                        false,
                        null,
                        "events.delivery.failed",
                        null,
                        null,
                        null,
                        null,
                        0,
                        10)))
                .singleElement()
                .satisfies(entry -> {
                    assertThat(entry.getActor()).isEqualTo(EXTENSION);
                    assertThat(entry.getChannel()).isEqualTo(AuditEvent.Channel.JOB);
                    assertThat(entry.getSubject()).contains(FLAKY_SUBSCRIBER);
                });
    }
}
