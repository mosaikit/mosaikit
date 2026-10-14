// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;

import dev.mosaikit.kernel.api.teams.People;
import dev.mosaikit.kernel.api.teams.Teams;
import dev.mosaikit.kernel.core.identity.OrganizationAccess;
import dev.mosaikit.kernel.core.jobs.OrganizationJobs;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.arc.Arc;
import io.quarkus.arc.ManagedContext;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.security.identity.CurrentIdentityAssociation;
import io.quarkus.security.runtime.QuarkusPrincipal;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The people and teams of the organization for the Java code of extensions (MK-032, MK-123): the
 * username of an account, the teams and groups of the organization, never chats, and their people,
 * in one organization only; a guest reads only their teams, and a job without a person reads what a
 * member does.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-032")
@Tag("MK-123")
class PeopleTest {

    static final String PASSWORD = "a long enough password";

    @Inject
    People people;

    @Inject
    OrganizationJobs jobs;

    private String town;
    private String other;
    private String administrator;
    private String owner;
    private String member;
    private String outsider;
    private String guest;
    private String foreigner;
    private String roads;
    private String parks;
    private String nightShift;
    private String chat;
    private String elsewhere;

    @BeforeEach
    void organization() {
        town = unique("people-town");
        other = unique("people-other");
        for (String slug : new String[] {town, other}) {
            asAdmin()
                    .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                    .post("/api/v1/organizations")
                    .then()
                    .statusCode(201);
        }
        administrator = register(town, "Ada");
        owner = register(town, "Bea");
        member = register(town, "Cleo");
        outsider = register(town, "Dora");
        guest = register(other, "Eva");
        foreigner = register(other, "Fay");
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", town, administrator)
                .then()
                .statusCode(200);

        roads = team(owner, town, Map.of("name", "Roads", "visibility", "private"));
        parks = team(owner, town, Map.of("name", "Parks", "visibility", "public"));
        put(roads, member, "member");
        put(roads, guest, "guest");
        nightShift = team(owner, town, Map.of("name", "Night shift", "parent", roads));
        put(nightShift, guest, "guest");
        chat = team(owner, town, Map.of("kind", "chat", "people", List.of(member)));
        elsewhere = team(foreigner, other, Map.of("name", "Elsewhere", "visibility", "public"));
    }

    private static String register(String organization, String name) {
        String email = unique("people") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", name, "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    private static String team(String person, String organization, Map<String, Object> body) {
        return in(person, organization)
                .body(body)
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
    }

    private void put(String team, String person, String role) {
        in(owner, town)
                .body(Map.of("role", role))
                .put("/api/v1/teams/" + team + "/members/" + person)
                .then()
                .statusCode(200);
    }

    private UUID account(String username) {
        return UUID.fromString(in(administrator, town)
                .get("/api/v1/test/people/by-username/{username}", username)
                .then()
                .statusCode(200)
                .extract()
                .path("account"));
    }

    private static UUID organizationId(String slug) {
        return UUID.fromString(
                asAdmin().get("/api/v1/organizations/{slug}", slug).path("id"));
    }

    /** Runs work outside the context of the test, with an identity of its own, as a request would. */
    private static <T> T with(QuarkusSecurityIdentity identity, Callable<T> work) {
        return CompletableFuture.supplyAsync(() -> {
                    try {
                        return OrganizationJobs.outsideRequests(() -> {
                            ManagedContext requests = Arc.container().requestContext();
                            requests.activate();
                            try {
                                Arc.container()
                                        .instance(CurrentIdentityAssociation.class)
                                        .get()
                                        .setIdentity(identity);
                                return QuarkusTransaction.requiringNew().call(work);
                            } finally {
                                requests.terminate();
                            }
                        });
                    } catch (Exception e) {
                        throw new IllegalStateException(e);
                    }
                })
                .join();
    }

    private static <T> T asJob(UUID organization, Callable<T> work, OrganizationJobs jobs) {
        return CompletableFuture.supplyAsync(() -> {
                    try {
                        return jobs.run(PlatformEventsTest.EXTENSION, organization, work);
                    } catch (Exception e) {
                        throw new IllegalStateException(e);
                    }
                })
                .join();
    }

    @Test
    void aMemberReadsThePeopleAndEveryTeamOfTheOrganizationButNoChat() {
        // Dora is in no team: she still reads every team, private ones and groups too, never the chat.
        RequestSpecification dora = in(outsider, town);
        dora.get("/api/v1/test/people")
                .then()
                .statusCode(200)
                .body("username", contains(administrator, owner, member, outsider, guest))
                .body("displayName", contains("Ada", "Bea", "Cleo", "Dora", "Eva"))
                .body("standing", contains("administrator", "member", "member", "member", "guest"))
                .body("active", contains(true, true, true, true, true));
        in(outsider, town)
                .get("/api/v1/test/people/teams")
                .then()
                .statusCode(200)
                .body("name", contains("Night shift", "Parks", "Roads"))
                .body("id", not(hasItem(chat)))
                .body("id", not(hasItem(elsewhere)))
                .body("find { it.name == 'Night shift' }.parent", equalTo(roads))
                .body("find { it.name == 'Roads' }.visibility", equalTo("private"));
        in(outsider, town)
                .get("/api/v1/test/people/teams/{team}/members", roads)
                .then()
                .statusCode(200)
                .body("email", contains(owner, member, guest))
                .body("role", contains("owner", "member", "guest"));
        in(outsider, town)
                .get("/api/v1/test/people/accounts/{account}/teams", account(guest))
                .then()
                .statusCode(200)
                .body("name", contains("Night shift", "Roads"));

        // The username in any case.
        in(outsider, town)
                .get("/api/v1/test/people/by-username/{username}", "  " + owner.toUpperCase() + " ")
                .then()
                .statusCode(200)
                .body("username", equalTo(owner))
                .body("standing", equalTo("member"));
    }

    @Test
    void anotherOrganizationIsNotReadNorAChatAsATeam() {
        in(outsider, town)
                .get("/api/v1/test/people/by-username/{username}", foreigner)
                .then()
                .statusCode(404);
        in(outsider, town)
                .get("/api/v1/test/people/teams/{team}/members", elsewhere)
                .then()
                .statusCode(200)
                .body("$", empty());
        in(outsider, town)
                .get("/api/v1/test/people/teams/{team}/members", chat)
                .then()
                .statusCode(200)
                .body("$", empty());
        // The guest is found in both organizations, as a guest here and as a member there.
        in(foreigner, other)
                .get("/api/v1/test/people/by-username/{username}", guest)
                .then()
                .statusCode(200)
                .body("standing", equalTo("member"));
        in(foreigner, other)
                .get("/api/v1/test/people/by-username/{username}", owner)
                .then()
                .statusCode(404);
    }

    @Test
    void aJobWithoutAPersonReadsWhatAMemberReads() {
        UUID organization = organizationId(town);
        List<People.OrganizationTeam> teams = asJob(organization, people::teams, jobs);
        assertThat(teams).extracting(People.OrganizationTeam::name).containsExactly("Night shift", "Parks", "Roads");
        List<People.Person> everybody = asJob(organization, people::list, jobs);
        assertThat(everybody)
                .extracting(People.Person::username)
                .containsExactly(administrator, owner, member, outsider, guest);
        List<Teams.Member> ofRoads = asJob(organization, () -> people.members(UUID.fromString(roads)), jobs);
        assertThat(ofRoads).extracting(Teams.Member::email).containsExactly(owner, member, guest);
        // The e-mail address of a person is their username.
        assertThat(asJob(organization, () -> people.findByUsername(owner.toUpperCase()), jobs))
                .hasValueSatisfying(person -> assertThat(person.email()).isEqualTo(owner));
    }

    @Test
    void aGuestReadsOnlyTheirTeamsAndTheirPeople() {
        UUID organization = organizationId(town);
        UUID eva = account(guest);
        UUID dora = account(outsider);
        QuarkusSecurityIdentity asGuest = QuarkusSecurityIdentity.builder()
                .setPrincipal(new QuarkusPrincipal(guest))
                .addRole(Roles.ORGANIZATION_GUEST)
                .addAttribute(OrganizationAccess.ORGANIZATION_ATTRIBUTE, organization.toString())
                .addAttribute(OrganizationAccess.ACCOUNT_ATTRIBUTE, eva.toString())
                .build();

        assertThat(with(asGuest, people::teams))
                .extracting(People.OrganizationTeam::name)
                .containsExactly("Night shift", "Roads");
        assertThat(with(asGuest, people::list))
                .extracting(People.Person::username)
                .containsExactly(owner, member, guest);
        assertThat(with(asGuest, () -> people.find(dora))).isEmpty();
        assertThat(with(asGuest, () -> people.findByUsername(administrator))).isEmpty();
        assertThat(with(asGuest, () -> people.members(UUID.fromString(parks)))).isEmpty();
        assertThat(with(asGuest, () -> people.teamsOf(dora))).isEmpty();
        assertThat(with(asGuest, () -> people.find(eva)))
                .hasValueSatisfying(person -> assertThat(person.standing()).isEqualTo("guest"));
        assertThat(with(asGuest, () -> people.members(UUID.fromString(roads))))
                .extracting(Teams.Member::email)
                .containsExactlyInAnyOrder(owner, member, guest);
    }

    @Test
    void aSuspendedAccountIsListedAsNotActive() {
        asAdmin()
                .put("/api/v1/platform/accounts/{email}/suspension", member)
                .then()
                .statusCode(200);
        in(outsider, town)
                .get("/api/v1/test/people/by-username/{username}", member)
                .then()
                .statusCode(200)
                .body("active", equalTo(false));
        in(outsider, town)
                .get("/api/v1/test/people")
                .then()
                .body("findAll { it.active == false }.username", containsInAnyOrder(member));
    }
}
