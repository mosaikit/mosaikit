// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.fail;

import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.app.EventSubscribersProbe.Received;
import dev.mosaikit.kernel.app.EventSubscribersProbe.Recorder;
import dev.mosaikit.kernel.core.events.PlatformEventDispatcher;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.function.Predicate;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Events of the platform for the changes of access (MK-085): a share made, changed or revoked
 * (MK-055), a person added to a team, changed or removed (MK-032), and a permission profile, team
 * grant or personal exception changed (MK-056) reach a subscriber, so that an extension that
 * translates them into the rules of another server does not poll.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-085")
@Tag("MK-055")
@Tag("MK-056")
@Tag("MK-032")
class AccessEventsTest {

    static final String ACCESS = EventSubscribersProbe.EVENTS + "/" + AccessEventsProbe.NAME;
    static final String PASSWORD = "a long enough password";
    static final Duration WAIT = Duration.ofSeconds(30);

    @Inject
    PlatformEventDispatcher dispatcher;

    @Inject
    Recorder recorder;

    private static String organization() {
        String slug = unique("access");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static UUID organizationId(String slug) {
        return UUID.fromString(
                asAdmin().get("/api/v1/organizations/{slug}", slug).path("id"));
    }

    private static String person(String organization) {
        String email = unique("access") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static void administrator(String email, String organization) {
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", organization, email)
                .then()
                .statusCode(200);
    }

    private static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    private static String account(String person, String organization) {
        return in(person, organization).get("/api/v1/accounts/me").path("id");
    }

    private static String team(String owner, String organization, Map<String, Object> body) {
        return in(owner, organization)
                .body(body)
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
    }

    private static void put(String owner, String organization, String team, String person, String role) {
        in(owner, organization)
                .body(Map.of("role", role))
                .put("/api/v1/teams/" + team + "/members/" + person)
                .then()
                .statusCode(200);
    }

    private void dispatch(Instant now) {
        CompletableFuture.supplyAsync(() -> dispatcher.dispatch(now)).join();
    }

    /** Delivers what is due until the subscriber received a matching event of a type. */
    private Received await(String type, Predicate<Received> match) {
        Instant end = Instant.now().plus(WAIT);
        while (Instant.now().isBefore(end)) {
            dispatch(Instant.now());
            Optional<Received> found =
                    recorder.of(ACCESS, type).stream().filter(match).findFirst();
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
        return fail("%s received no matching %s within %s", ACCESS, type, WAIT);
    }

    private static Predicate<Received> in(UUID organization) {
        return found -> found.event().organization().equals(organization);
    }

    private static Predicate<Received> with(String name, Object value) {
        return found -> value.equals(found.event().payload().get(name));
    }

    @Test
    void theChangesOfThePeopleOfATeamReachTheSubscriber() {
        String town = organization();
        String other = organization();
        UUID townId = organizationId(town);
        String owner = person(town);
        String member = person(town);
        String guest = person(other);
        String ownerId = account(owner, town);
        String memberId = account(member, town);

        String roads = team(owner, town, Map.of("name", "Roads", "visibility", "private"));
        Received created = await(PlatformEvents.TEAM_MEMBER_ADDED, in(townId).and(with("team", roads)));
        assertThat(created.event().payload())
                .containsEntry("account", ownerId)
                .containsEntry("role", "owner")
                .doesNotContainKey("parent");
        assertThat(created.event().source()).isEqualTo(PlatformEvents.KERNEL);

        put(owner, town, roads, member, "member");
        await(
                PlatformEvents.TEAM_MEMBER_ADDED,
                with("team", roads).and(with("account", memberId)).and(with("role", "member")));
        put(owner, town, roads, member, "owner");
        Received changed =
                await(PlatformEvents.TEAM_MEMBER_CHANGED, with("team", roads).and(with("account", memberId)));
        assertThat(changed.event().payload()).containsEntry("role", "owner").containsEntry("previousRole", "member");

        // A guest of another organization, and a group of the team.
        put(owner, town, roads, guest, "guest");
        await(PlatformEvents.TEAM_MEMBER_ADDED, with("team", roads).and(with("role", "guest")));
        String night = team(owner, town, Map.of("name", "Night shift", "parent", roads));
        Received group = await(PlatformEvents.TEAM_MEMBER_ADDED, with("team", night));
        assertThat(group.event().payload()).containsEntry("parent", roads);

        in(owner, town)
                .delete("/api/v1/teams/" + roads + "/members/" + member)
                .then()
                .statusCode(204);
        Received removed =
                await(PlatformEvents.TEAM_MEMBER_REMOVED, with("team", roads).and(with("account", memberId)));
        assertThat(removed.event().payload()).containsEntry("role", "owner");

        // A chat is not a team: none of its people raise an event.
        String chat = team(owner, town, Map.of("kind", "chat", "people", List.of(member)));
        dispatch(Instant.now());
        dispatch(Instant.now().plus(Duration.ofDays(1)));
        assertThat(recorder.of(ACCESS, PlatformEvents.TEAM_MEMBER_ADDED))
                .noneMatch(found -> chat.equals(found.event().text("team")));

        // Deleting the team removes its people.
        in(owner, town).delete("/api/v1/teams/" + roads).then().statusCode(204);
        await(PlatformEvents.TEAM_MEMBER_REMOVED, with("team", roads).and(with("account", ownerId)));
        await(PlatformEvents.TEAM_MEMBER_REMOVED, with("team", night).and(with("account", ownerId)));
    }

    @Test
    void theChangesOfPermissionsReachTheSubscriber() {
        String acme = organization();
        UUID acmeId = organizationId(acme);
        String boss = person(acme);
        String ada = person(acme);
        administrator(boss, acme);
        String adaId = account(ada, acme);
        String admin = "/api/v1/organizations/" + acme + "/permissions";
        String create = PermissionsTest.CREATE;
        String view = PermissionsTest.VIEW;

        String builders = in(boss, acme)
                .body(Map.of("name", "Builders", "permissions", List.of(create)))
                .post(admin + "/profiles")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
        Received created =
                await(PlatformEvents.PERMISSIONS_PROFILE_CHANGED, in(acmeId).and(with("profile", builders)));
        assertThat(created.event().payload())
                .containsEntry("change", "created")
                .containsEntry("defaultForRole", "")
                .containsEntry("added", List.of(create))
                .containsEntry("removed", List.of());

        in(boss, acme)
                .body(Map.of("name", "Builders", "permissions", List.of(view)))
                .put(admin + "/profiles/" + builders)
                .then()
                .statusCode(200);
        Received changed = await(
                PlatformEvents.PERMISSIONS_PROFILE_CHANGED,
                with("profile", builders).and(with("change", "changed")));
        assertThat(changed.event().payload())
                .containsEntry("added", List.of(view))
                .containsEntry("removed", List.of(create));

        in(boss, acme)
                .body(Map.of("profile", builders))
                .put(admin + "/members/{email}/profile", ada)
                .then()
                .statusCode(200);
        Received assigned = await(PlatformEvents.PERMISSIONS_PROFILE_ASSIGNED, with("account", adaId));
        assertThat(assigned.event().payload()).containsEntry("profile", builders);

        String roads = team(boss, acme, Map.of("name", "Roads", "visibility", "private"));
        in(boss, acme)
                .put(admin + "/teams/{id}/{permission}", roads, create)
                .then()
                .statusCode(200);
        await(
                PlatformEvents.PERMISSIONS_TEAM_CHANGED,
                with("team", roads).and(with("permission", create)).and(with("granted", true)));
        in(boss, acme)
                .delete(admin + "/teams/{id}/{permission}", roads, create)
                .then()
                .statusCode(200);
        await(
                PlatformEvents.PERMISSIONS_TEAM_CHANGED,
                with("team", roads).and(with("permission", create)).and(with("granted", false)));

        in(boss, acme)
                .put(admin + "/members/{email}/exceptions/{permission}", ada, create)
                .then()
                .statusCode(200);
        await(
                PlatformEvents.PERMISSIONS_EXCEPTION_CHANGED,
                with("account", adaId).and(with("permission", create)).and(with("granted", true)));
        in(boss, acme)
                .delete(admin + "/members/{email}/exceptions/{permission}", ada, create)
                .then()
                .statusCode(200);
        await(
                PlatformEvents.PERMISSIONS_EXCEPTION_CHANGED,
                with("account", adaId).and(with("permission", create)).and(with("granted", false)));

        in(boss, acme).delete(admin + "/profiles/" + builders).then().statusCode(204);
        Received deleted = await(
                PlatformEvents.PERMISSIONS_PROFILE_CHANGED,
                with("profile", builders).and(with("change", "deleted")));
        assertThat(deleted.event().payload()).containsEntry("removed", List.of(view));
    }

    @Test
    void aShareMadeChangedAndRevokedReachesTheSubscriber() {
        String acme = organization();
        UUID acmeId = organizationId(acme);
        String owner = person(acme);
        String bea = person(acme);
        String beaId = account(bea, acme);
        String extension = SharingTest.EXTENSION;
        String id = unique("doc");
        in(owner, acme)
                .body(Map.of("title", "Plans", "link", "/app/sharing/" + id))
                .put("/api/v1/test/resources/" + extension + "/doc/" + id)
                .then()
                .statusCode(200);
        String grants = "/api/v1/sharing/resources/" + extension + "/doc/" + id + "/grants";

        String grant = in(owner, acme)
                .body(Map.of("subject", Map.of("kind", "person", "id", beaId), "level", "view"))
                .put(grants)
                .then()
                .statusCode(200)
                .extract()
                .path("id");
        Received granted = await(PlatformEvents.SHARING_GRANTED, in(acmeId).and(with("grant", grant)));
        assertThat(granted.event().payload())
                .containsEntry("extension", extension)
                .containsEntry("type", "doc")
                .containsEntry("id", id)
                .containsEntry("subject", "person")
                .containsEntry("subjectId", beaId)
                .containsEntry("level", "view");

        in(owner, acme)
                .body(Map.of("subject", Map.of("kind", "person", "id", beaId), "level", "edit"))
                .put(grants)
                .then()
                .statusCode(200);
        Received changed = await(PlatformEvents.SHARING_CHANGED, with("grant", grant));
        assertThat(changed.event().payload()).containsEntry("level", "edit").containsEntry("previousLevel", "view");

        in(owner, acme).delete("/api/v1/sharing/grants/{grant}", grant).then().statusCode(204);
        Received revoked = await(PlatformEvents.SHARING_REVOKED, with("grant", grant));
        assertThat(revoked.event().payload()).containsEntry("subjectId", beaId).containsEntry("level", "edit");
        assertThat(revoked.currentOrganization()).isEqualTo(acmeId);
    }
}
