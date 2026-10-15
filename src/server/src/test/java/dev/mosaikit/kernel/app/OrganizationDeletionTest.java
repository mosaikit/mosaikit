// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.fail;
import static org.hamcrest.Matchers.equalTo;

import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.app.EventSubscribersProbe.Received;
import dev.mosaikit.kernel.app.EventSubscribersProbe.Recorder;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.audit.AuditQuery;
import dev.mosaikit.kernel.core.events.PlatformEventDispatcher;
import dev.mosaikit.kernel.core.organization.OrganizationRemovals;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import io.restassured.response.Response;
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
import java.util.concurrent.CompletionException;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Deleting an organization (MK-130): a platform administrator deletes it after naming it again; its
 * people lose access at once and it appears nowhere; the extensions subscribed to
 * {@code organization.deleted} are called; its data and those of its extensions stay for the
 * retention of the installation, then a job removes them; the audit log records both. The links made
 * before the deletion (MK-093, MK-055) answer not found from it on (#150).
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-130")
class OrganizationDeletionTest {

    static final String EXTENSION = "dev.mosaikit.test.removal";
    static final String SCHEMA = "ext_removal";

    /** Two tables of organization data, the second referencing the first without cascade. */
    static final String MIGRATION = """
            create table album (
                id              uuid primary key,
                organization_id uuid not null default mk_kernel.current_organization(),
                title           varchar(100) not null
            );
            alter table album enable row level security;
            create policy album_organization on album
                using (organization_id = mk_kernel.current_organization())
                with check (organization_id = mk_kernel.current_organization());

            create table photo (
                id              uuid primary key,
                organization_id uuid not null default mk_kernel.current_organization(),
                album_id        uuid not null references album (id),
                title           varchar(100) not null
            );
            alter table photo enable row level security;
            create policy photo_organization on photo
                using (organization_id = mk_kernel.current_organization())
                with check (organization_id = mk_kernel.current_organization());
            """;

    private static final String SESSION = "mosaikit-session";
    private static final String PASSWORD = "a long enough password";
    private static final String PREPARE = PlatformEventsTest.PREPARE;
    private static final String BOARD = PlatformEventsTest.BOARD_SUBSCRIBER;
    private static final Duration WAIT = Duration.ofSeconds(30);

    @Inject
    OrganizationRemovals removals;

    @Inject
    PlatformEventDispatcher dispatcher;

    @Inject
    Recorder recorder;

    @Inject
    AuditLog audit;

    @Inject
    AgroalDataSource dataSource;

    private String slug;
    private UUID id;
    private String person;

    @BeforeEach
    void anOrganizationWithAPerson() {
        slug = organization();
        id = id(slug);
        person = unique("deleted") + "@example.org";
        anonymous()
                .body(Map.of("organization", slug, "email", person, "displayName", "Pat", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", slug, person)
                .then()
                .statusCode(200);
    }

    private static String organization() {
        String slug = unique("deletion");
        asAdmin()
                .body(Map.of("slug", slug, "name", "Acme " + slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static UUID id(String slug) {
        return UUID.fromString(
                asAdmin().get("/api/v1/organizations/{slug}", slug).path("id"));
    }

    private static String signIn(String username, String organization) {
        return given().formParam("username", username)
                .formParam("password", PASSWORD)
                .header("X-Mosaikit-Organization", organization)
                .post("/api/v1/accounts/session")
                .then()
                .statusCode(200)
                .extract()
                .cookie(SESSION);
    }

    private static Map<String, Object> delete(String slug, String confirmation) {
        return asAdmin()
                .queryParam("confirmation", confirmation)
                .delete("/api/v1/organizations/{slug}", slug)
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getMap("");
    }

    @Test
    void theDeletionIsConfirmedByTheSlugOfTheOrganizationAndOnlyByAPlatformAdministrator() {
        asAdmin().delete("/api/v1/organizations/{slug}", slug).then().statusCode(400);
        asAdmin()
                .queryParam("confirmation", "another")
                .delete("/api/v1/organizations/{slug}", slug)
                .then()
                .statusCode(400);
        // An administrator of the organization is not a platform administrator.
        as(person, PASSWORD)
                .header("X-Mosaikit-Organization", slug)
                .queryParam("confirmation", slug)
                .delete("/api/v1/organizations/{slug}", slug)
                .then()
                .statusCode(403);
        asAdmin().get("/api/v1/organizations/{slug}", slug).then().statusCode(200);
        asAdmin()
                .queryParam("confirmation", "nothing-here")
                .delete("/api/v1/organizations/{slug}", "nothing-here")
                .then()
                .statusCode(404);
    }

    @Test
    void itsPeopleLoseAccessAtOnceAndItAppearsNowhere() {
        // The person belongs to another organization too, which they keep.
        String other = organization();
        asAdmin()
                .body(Map.of("roles", List.of("organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", other, person)
                .then()
                .statusCode(200);
        String cookie = signIn(person, slug);
        given().cookie(SESSION, cookie).get("/api/v1/accounts/me").then().statusCode(200);

        Map<String, Object> deleted = delete(slug, slug);

        assertThat(deleted)
                .containsEntry("slug", slug)
                .containsEntry("id", id.toString())
                .containsEntry("members", 1);
        Instant removableFrom = Instant.parse((String) deleted.get("removableFrom"));
        assertThat(removableFrom)
                .isAfter(Instant.parse((String) deleted.get("deletedAt")).plus(Duration.ofDays(29)));
        // The session in it ended at once.
        given().cookie(SESSION, cookie).get("/api/v1/accounts/me").then().statusCode(401);
        // Nobody acts on it any more: it is not found, even by its administrators.
        as(person, PASSWORD)
                .header("X-Mosaikit-Organization", slug)
                .get("/api/v1/organizations/{slug}/permissions", slug)
                .then()
                .statusCode(404);
        // A request that names it acts on no organization, so on no data of one.
        Map<String, Object> me = as(person, PASSWORD)
                .header("X-Mosaikit-Organization", slug)
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getMap("");
        assertThat(me.get("organization")).isNull();
        assertThat(me.get("organizationId")).isNull();
        // It appears nowhere: not to the platform, not among the organizations of the person, not on
        // the sign-in page, not in the published views.
        asAdmin().get("/api/v1/organizations/{slug}", slug).then().statusCode(404);
        List<String> listed = asAdmin().get("/api/v1/organizations").jsonPath().getList("slug");
        assertThat(listed).contains(other).doesNotContain(slug);
        List<String> memberships =
                as(person, PASSWORD).get("/api/v1/accounts/me").jsonPath().getList("memberships.slug");
        assertThat(memberships).containsExactly(other);
        List<String> registration = anonymous()
                .get("/api/v1/accounts/registration-options")
                .jsonPath()
                .getList("organizations.slug");
        assertThat(registration).doesNotContain(slug);
        assertThat(count("select count(*) from mk_published.organization where id = ?", id))
                .isZero();
        assertThat(count("select count(*) from mk_published.membership where organization_id = ?", id))
                .isZero();
        // Its slug stays taken until it is removed.
        asAdmin()
                .body(Map.of("slug", slug, "name", "Again"))
                .post("/api/v1/organizations")
                .then()
                .statusCode(409);
        // A second deletion finds nothing.
        asAdmin()
                .queryParam("confirmation", slug)
                .delete("/api/v1/organizations/{slug}", slug)
                .then()
                .statusCode(404);
    }

    @Test
    @Tag("MK-093")
    @Tag("MK-055")
    void theLinksMadeBeforeTheDeletionAnswerNotFoundFromItOn() {
        // #150: a signed link to a file, one to a prefix, and a sharing link, all made and working
        // before the deletion, valid for days after it.
        String files = "/api/v1/test/files/" + PlatformEventsTest.EXTENSION;
        String file = in(slug).contentType("text/plain")
                .body("plans")
                .post(files + "?name=plan.txt")
                .then()
                .statusCode(200)
                .extract()
                .path("id");
        in(slug).contentType("text/plain")
                .body("tile")
                .post(files + "?name=tiles/1.txt")
                .then()
                .statusCode(200);
        String toFile = in(slug).post(files + "/" + file + "/link")
                .then()
                .statusCode(200)
                .extract()
                .path("path");
        JsonPath toPrefix = in(slug).post(files + "/links?prefix=tiles/")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath();
        String tile = toPrefix.getString("base") + "tiles/1.txt?" + toPrefix.getString("query");
        in(slug).body(Map.of("title", "Plans", "link", "/app/sharing/plans"))
                .put("/api/v1/test/resources/" + SharingTest.EXTENSION + "/doc/plans")
                .then()
                .statusCode(200);
        String token = in(slug).body(Map.of(
                        "level",
                        "use",
                        "expires",
                        Instant.now().plus(Duration.ofDays(5)).toString()))
                .post("/api/v1/sharing/resources/" + SharingTest.EXTENSION + "/doc/plans/links")
                .then()
                .statusCode(201)
                .extract()
                .path("token");
        given().urlEncodingEnabled(false).get(toFile).then().statusCode(200).body(equalTo("plans"));
        given().urlEncodingEnabled(false).get(tile).then().statusCode(200).body(equalTo("tile"));
        openLink(token).then().statusCode(200);
        assertThat(linkLevel(token)).isEqualTo("use");

        delete(slug, slug);

        // From the deletion on, while its data are still kept: not found, as an unknown link.
        given().urlEncodingEnabled(false).get(toFile).then().statusCode(404);
        given().urlEncodingEnabled(false).get(tile).then().statusCode(404);
        openLink(token).then().statusCode(404);
        assertThat(linkLevel(token)).isEmpty();
        assertThat(count("select count(*) from mk_kernel.stored_file where organization_id = ?", id))
                .isEqualTo(2);
    }

    private RequestSpecification in(String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    private static Response openLink(String token) {
        return anonymous().body(Map.of("token", token)).post("/api/v1/sharing/links/open");
    }

    /** The level that a request opened with a sharing link gets on the doc, or null. */
    private static String linkLevel(String token) {
        return anonymous()
                .header("X-Mosaikit-Link", token)
                .get("/api/v1/test/sharing/" + SharingTest.EXTENSION + "/doc/plans/level")
                .then()
                .statusCode(200)
                .extract()
                .path("level");
    }

    @Test
    void everySubscribedExtensionIsToldInTheOrganization() {
        delete(slug, slug);

        for (String subscriber : List.of(PREPARE, BOARD)) {
            Received told = await(subscriber);
            assertThat(told.event().source()).isEqualTo(PlatformEvents.KERNEL);
            assertThat(told.event().text("slug")).isEqualTo(slug);
            assertThat(told.event().payload()).containsKeys("name", "removableFrom");
            // The handler runs in the organization, whose data are still there.
            assertThat(told.currentOrganization()).isEqualTo(id);
            assertThat(told.databaseOrganization()).isEqualTo(id.toString());
        }
    }

    @Test
    void itsDataStayForTheRetentionThenAJobRemovesThemWithThoseOfItsExtensions() {
        String other = organization();
        UUID otherId = id(other);
        UUID album = UUID.randomUUID();
        UUID otherAlbum = UUID.randomUUID();
        insertAlbum(album, id);
        insertAlbum(otherAlbum, otherId);
        String file = as(person, PASSWORD)
                .header("X-Mosaikit-Organization", slug)
                .contentType("text/plain")
                .body("plans")
                .post("/api/v1/test/files/{extension}?name=plan.txt", PlatformEventsTest.EXTENSION)
                .then()
                .statusCode(200)
                .extract()
                .path("id");

        Instant removableFrom = Instant.parse((String) delete(slug, slug).get("removableFrom"));

        // Before the retention, nothing is removed: not even a run long after the deletion but
        // before removableFrom.
        assertThat(removeDue(removableFrom.minusSeconds(1)))
                .noneMatch(removed -> removed.id().equals(id));
        assertThat(count("select count(*) from mk_kernel.organization where id = ?", id))
                .isOne();
        assertThat(count("select count(*) from mk_kernel.organization_member where organization_id = ?", id))
                .isOne();
        assertThat(count("select count(*) from ext_removal.album where organization_id = ?", id))
                .isOne();
        assertThat(count("select count(*) from mk_kernel.stored_file where organization_id = ?", id))
                .isOne();

        List<OrganizationRemovals.Removed> removed = removeDue(removableFrom.plusSeconds(1));

        assertThat(removed)
                .filteredOn(found -> found.id().equals(id))
                .singleElement()
                .satisfies(found -> {
                    assertThat(found.slug()).isEqualTo(slug);
                    assertThat(found.extensionRows()).containsEntry(SCHEMA, 3L);
                    assertThat(found.files()).isOne();
                });
        // The organization, its kernel data and the data of its extensions are gone; the content of
        // its file waits for the clean-up of the store.
        assertThat(count("select count(*) from mk_kernel.organization where id = ?", id))
                .isZero();
        assertThat(count("select count(*) from mk_kernel.organization_member where organization_id = ?", id))
                .isZero();
        assertThat(count("select count(*) from mk_kernel.platform_event where organization_id = ?", id))
                .isZero();
        assertThat(count("select count(*) from ext_removal.album where organization_id = ?", id))
                .isZero();
        assertThat(count("select count(*) from ext_removal.photo where organization_id = ?", id))
                .isZero();
        assertThat(count(
                        "select count(*) from mk_kernel.file_removal where organization_id = ?"
                                + " and reason = 'organization' and file_id = ?",
                        id,
                        UUID.fromString(file)))
                .isOne();
        // Another organization, not deleted, keeps everything, however late the job runs.
        assertThat(count("select count(*) from mk_kernel.organization where id = ?", otherId))
                .isOne();
        assertThat(count("select count(*) from ext_removal.album where organization_id = ?", otherId))
                .isOne();
        assertThat(count("select count(*) from ext_removal.photo where organization_id = ?", otherId))
                .isEqualTo(2);
        // The slug is free again.
        asAdmin()
                .body(Map.of("slug", slug, "name", "Again"))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
    }

    @Test
    void theAuditLogRecordsTheDeletionAndTheRemoval() {
        Instant removableFrom = Instant.parse((String) delete(slug, slug).get("removableFrom"));
        removeDue(removableFrom.plusSeconds(1));

        assertThat(entries("organization.deleted")).singleElement().satisfies(entry -> {
            assertThat(entry.getActor()).isEqualTo("admin");
            assertThat(entry.getSubject()).contains(slug);
            assertThat(entry.getDetail())
                    .hasValueSatisfying(detail -> assertThat(detail).contains("removableFrom", "\"members\":1"));
        });
        assertThat(entries("organization.removed")).singleElement().satisfies(entry -> {
            assertThat(entry.getChannel()).isEqualTo(AuditEvent.Channel.JOB);
            assertThat(entry.getSubject()).contains(slug);
            assertThat(entry.getDetail())
                    .hasValueSatisfying(detail -> assertThat(detail).contains("deletedBy", "filesQueued"));
        });
    }

    @Test
    void noMisconfigurationRemovesAnOrganizationAtOnce() {
        // A missing, zero or negative retention is one day.
        Duration day = Duration.ofDays(1);
        assertThat(OrganizationRemovals.retention(null)).isEqualTo(day);
        assertThat(OrganizationRemovals.retention(Duration.ZERO)).isEqualTo(day);
        assertThat(OrganizationRemovals.retention(Duration.ofDays(-3))).isEqualTo(day);
        assertThat(OrganizationRemovals.retention(Duration.ofHours(2))).isEqualTo(day);
        assertThat(OrganizationRemovals.retention(Duration.ofDays(90))).isEqualTo(Duration.ofDays(90));
        // The database refuses an organization deleted with less than a day of retention, whatever
        // the code says.
        assertThatThrownBy(() -> update(
                        "update mk_kernel.organization set deleted_at = now(), deleted_by = 'admin',"
                                + " removable_from = now() where id = ?",
                        id))
                .hasMessageContaining("organization_deletion_ck");
        // A live organization is never removed, however late the job runs.
        removeDue(Instant.now().plus(Duration.ofDays(3650)));
        asAdmin().get("/api/v1/organizations/{slug}", slug).then().statusCode(200);
    }

    private List<AuditEvent> entries(String action) {
        return audit.search(new AuditQuery(Optional.of(id), false, null, action, null, null, null, null, 0, 10));
    }

    private List<OrganizationRemovals.Removed> removeDue(Instant now) {
        return outside(() -> removals.removeDue(now));
    }

    private Received await(String subscriber) {
        Instant end = Instant.now().plus(WAIT);
        while (Instant.now().isBefore(end)) {
            outside(() -> dispatcher.dispatch(Instant.now()));
            Optional<Received> found = recorder.of(subscriber, PlatformEvents.ORGANIZATION_DELETED).stream()
                    .filter(received -> received.event().organization().equals(id))
                    .findFirst();
            if (found.isPresent()) {
                return found.get();
            }
            try {
                Thread.sleep(100);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
        }
        return fail("%s was not told of the deletion within %s", subscriber, WAIT);
    }

    /** An album of an organization, with two photos in it, written as the owner of the tables. */
    private void insertAlbum(UUID album, UUID organization) {
        update(
                "insert into ext_removal.album (id, organization_id, title) values (?, ?, 'Summer')",
                album,
                organization);
        for (String title : List.of("Beach", "Sunset")) {
            update(
                    "insert into ext_removal.photo (id, organization_id, album_id, title) values (?, ?, ?, ?)",
                    UUID.randomUUID(),
                    organization,
                    album,
                    title);
        }
    }

    /** Runs outside the context of the test, as the scheduler of the kernel does, as the owner. */
    private static <T> T outside(Supplier<T> work) {
        return CompletableFuture.supplyAsync(work).join();
    }

    private long count(String sql, Object... values) {
        return outside(() -> {
            try (var connection = dataSource.getConnection();
                    var statement = connection.prepareStatement(sql)) {
                for (int i = 0; i < values.length; i++) {
                    statement.setObject(i + 1, values[i]);
                }
                try (var result = statement.executeQuery()) {
                    result.next();
                    return result.getLong(1);
                }
            } catch (SQLException e) {
                throw new IllegalStateException(e);
            }
        });
    }

    private void update(String sql, Object... values) {
        try {
            outside(() -> {
                try (var connection = dataSource.getConnection();
                        var statement = connection.prepareStatement(sql)) {
                    for (int i = 0; i < values.length; i++) {
                        statement.setObject(i + 1, values[i]);
                    }
                    return statement.executeUpdate();
                } catch (SQLException e) {
                    throw new IllegalStateException(e.getMessage(), e);
                }
            });
        } catch (CompletionException e) {
            throw (RuntimeException) e.getCause();
        }
    }
}
