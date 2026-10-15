// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The console of the platform administrators (MK-072): only they reach it; it shows the organizations,
 * active and suspended, the people, the active extensions, the metrics of the system and the security
 * events such as refused sign-ins; and it lists the people of the installation with their
 * organizations, found by name and by state.
 */
@QuarkusTest
@Tag("MK-072")
class PlatformConsoleTest {

    private static final String CONSOLE = "/api/v1/platform/console";
    private static final String PEOPLE = "/api/v1/platform/accounts";
    private static final String PASSWORD = "a long enough password";

    private String slug;
    private String person;

    @BeforeEach
    void anOrganizationWithAnAdministrator() {
        slug = unique("console");
        asAdmin()
                .body(Map.of("slug", slug, "name", "Green " + slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        person = unique("console-admin") + "@example.org";
        anonymous()
                .body(Map.of("organization", slug, "email", person, "displayName", "Robin Green", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", slug, person)
                .then()
                .statusCode(200);
    }

    private static JsonPath console() {
        return asAdmin().get(CONSOLE).then().statusCode(200).extract().jsonPath();
    }

    @Test
    void onlyPlatformAdministratorsReachTheConsole() {
        anonymous().get(CONSOLE).then().statusCode(401);
        as(person, PASSWORD)
                .header("X-Mosaikit-Organization", slug)
                .get(CONSOLE)
                .then()
                .statusCode(403);
        as(person, PASSWORD).get(PEOPLE).then().statusCode(403);
        asAdmin().get(CONSOLE).then().statusCode(200);
    }

    @Test
    void itShowsOrganizationsPeopleExtensionsAndTheMetricsOfTheSystem() {
        JsonPath before = console();
        asAdmin()
                .body(Map.of("reason", "Trial ended"))
                .put("/api/v1/organizations/{slug}/suspension", slug)
                .then()
                .statusCode(200);
        JsonPath after = console();

        assertThat(after.getLong("organizations.total")).isEqualTo(before.getLong("organizations.total"));
        assertThat(after.getLong("organizations.suspended")).isEqualTo(before.getLong("organizations.suspended") + 1);
        assertThat(after.getLong("organizations.active"))
                .isEqualTo(after.getLong("organizations.total") - after.getLong("organizations.suspended"));
        assertThat(after.getLong("people.total")).isPositive();
        assertThat(after.getLong("people.suspended")).isNotNegative();
        assertThat(after.getLong("extensions.active"))
                .isEqualTo((long) after.getList("extensions.list").size());
        assertThat(after.getString("system.version")).isNotBlank();
        assertThat(after.getLong("system.uptimeSeconds")).isNotNegative();
        assertThat(after.getLong("system.heapUsedBytes")).isPositive();
        assertThat(after.getLong("system.heapMaxBytes")).isGreaterThanOrEqualTo(after.getLong("system.heapUsedBytes"));
        assertThat(after.getInt("system.processors")).isPositive();
        assertThat(after.getInt("system.threads")).isPositive();
        assertThat(after.getString("system.startedAt")).isNotBlank();
    }

    @Test
    void refusedSignInsAreSecurityEventsOfTheConsole() {
        long before = console().getLong("security.failedSignIns");
        String stranger = unique("intruder") + "@example.org";
        given().formParam("username", stranger.toUpperCase())
                .formParam("password", "not the password")
                .post("/api/v1/accounts/session")
                .then()
                .statusCode(401);
        given().formParam("username", person)
                .formParam("password", "a wrong password")
                .post("/api/v1/accounts/session")
                .then()
                .statusCode(401);

        JsonPath after = console();

        assertThat(after.getLong("security.failedSignIns")).isGreaterThanOrEqualTo(before + 2);
        assertThat(after.getString("security.since")).isNotBlank();
        List<Map<String, Object>> events = after.getList("security.events");
        assertThat(events)
                .filteredOn(event -> stranger.equals(event.get("subject")))
                .singleElement()
                .satisfies(event -> {
                    assertThat(event)
                            .containsEntry("action", "account.sign-in.failed")
                            .containsEntry("outcome", "DENIED")
                            .containsEntry("actor", stranger);
                    assertThat(String.valueOf(event.get("detail"))).doesNotContain("not the password");
                });
        assertThat(events).anyMatch(event -> person.equals(event.get("subject")));
    }

    @Test
    void itListsThePeopleOfTheInstallationWithTheirOrganizations() {
        JsonPath found = asAdmin()
                .queryParam("search", "ROBIN green")
                .get(PEOPLE)
                .then()
                .statusCode(200)
                .extract()
                .jsonPath();
        List<Map<String, Object>> people = found.getList("people");
        assertThat(people)
                .filteredOn(candidate -> person.equals(candidate.get("username")))
                .singleElement()
                .satisfies(candidate -> {
                    assertThat(candidate)
                            .containsEntry("displayName", "Robin Green")
                            .containsEntry("suspended", false)
                            .containsEntry("platformAdmin", false)
                            .containsEntry("password", true);
                    assertThat(candidate.get("organizations").toString()).contains(slug);
                });
        assertThat(found.getLong("total")).isGreaterThanOrEqualTo(people.size());

        // By address, and by state.
        assertThat(asAdmin().queryParam("search", person).get(PEOPLE).jsonPath().getList("people.username"))
                .containsExactly(person);
        assertThat(asAdmin()
                        .queryParam("search", person)
                        .queryParam("state", "suspended")
                        .get(PEOPLE)
                        .jsonPath()
                        .getList("people"))
                .isEmpty();
        asAdmin()
                .body(Map.of("reason", "Left"))
                .put(PEOPLE + "/{email}/suspension", person)
                .then()
                .statusCode(200);
        JsonPath suspended = asAdmin()
                .queryParam("search", person)
                .queryParam("state", "suspended")
                .get(PEOPLE)
                .jsonPath();
        assertThat(suspended.getList("people.username")).containsExactly(person);
        assertThat(suspended.getString("people[0].reason")).isEqualTo("Left");
        assertThat(asAdmin()
                        .queryParam("search", person)
                        .queryParam("state", "active")
                        .get(PEOPLE)
                        .jsonPath()
                        .getList("people"))
                .isEmpty();
        // The wildcards of the search are plain text.
        assertThat(asAdmin().queryParam("search", "%").get(PEOPLE).jsonPath().getList("people.username"))
                .allMatch(username -> String.valueOf(username).contains("%"));
        // Pages.
        JsonPath page = asAdmin().queryParam("limit", 1).get(PEOPLE).jsonPath();
        assertThat(page.getList("people")).hasSize(1);
        assertThat(page.getLong("total")).isGreaterThanOrEqualTo(2);
    }
}
