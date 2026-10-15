// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.nullValue;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.audit.AuditQuery;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Suspending an organization (MK-072): a platform administrator suspends it, with a reason, and
 * reactivates it. While it is suspended its members sign in to it by no means: their sessions in it
 * end at once, a password or an access key that names it acts on no organization, and it is not among
 * their organizations; its data and their keys stay, and work again once it is reactivated. The audit
 * log records both.
 */
@QuarkusTest
@Tag("MK-072")
class OrganizationSuspensionTest {

    private static final String SESSION = "mosaikit-session";
    private static final String PASSWORD = "a long enough password";

    @Inject
    AuditLog audit;

    private String slug;
    private UUID id;
    private String person;

    @BeforeEach
    void anOrganizationWithAnAdministrator() {
        slug = unique("suspension");
        asAdmin()
                .body(Map.of("slug", slug, "name", "Acme " + slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        id = UUID.fromString(asAdmin().get("/api/v1/organizations/{slug}", slug).path("id"));
        person = unique("suspended-org") + "@example.org";
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

    private Map<String, Object> suspend(String reason) {
        return asAdmin()
                .body(Map.of("reason", reason))
                .put("/api/v1/organizations/{slug}/suspension", slug)
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getMap("");
    }

    @Test
    void onlyAPlatformAdministratorSuspendsAndTheReasonIsShort() {
        as(person, PASSWORD)
                .header("X-Mosaikit-Organization", slug)
                .body(Map.of("reason", "mine"))
                .put("/api/v1/organizations/{slug}/suspension", slug)
                .then()
                .statusCode(403);
        anonymous().put("/api/v1/organizations/{slug}/suspension", slug).then().statusCode(401);
        asAdmin()
                .body(Map.of("reason", "x".repeat(501)))
                .put("/api/v1/organizations/{slug}/suspension", slug)
                .then()
                .statusCode(400);
        asAdmin()
                .body(Map.of("reason", "none"))
                .put("/api/v1/organizations/{slug}/suspension", "nothing-here")
                .then()
                .statusCode(404);
        asAdmin()
                .get("/api/v1/organizations/{slug}", slug)
                .then()
                .statusCode(200)
                .body("suspended", equalTo(false))
                .body("suspension", nullValue());
    }

    @Test
    void itsMembersCannotSignInToItUntilItIsReactivated() {
        String cookie = signIn(person, slug);
        String key = as(person, PASSWORD)
                .header("X-Mosaikit-Organization", slug)
                .body(Map.of("name", "Reports", "organization", slug))
                .post("/api/v1/accounts/me/access-keys")
                .then()
                .statusCode(201)
                .extract()
                .path("secret");
        given().header("Authorization", "Bearer " + key)
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(200)
                .body("organization", equalTo(slug));

        Map<String, Object> suspended = suspend("Unpaid invoices");

        assertThat(suspended).containsEntry("suspended", true).containsEntry("slug", slug);
        @SuppressWarnings("unchecked")
        Map<String, Object> suspension = (Map<String, Object>) suspended.get("suspension");
        assertThat(suspension).containsEntry("by", "admin").containsEntry("reason", "Unpaid invoices");
        assertThat(suspension.get("at")).isNotNull();
        // Listed as suspended to the platform administrators.
        List<Map<String, Object>> listed =
                asAdmin().get("/api/v1/organizations").jsonPath().getList("");
        assertThat(listed)
                .filteredOn(organization -> slug.equals(organization.get("slug")))
                .singleElement()
                .satisfies(organization -> assertThat(organization).containsEntry("suspended", true));
        // The session in it ended at once.
        given().cookie(SESSION, cookie).get("/api/v1/accounts/me").then().statusCode(401);
        // A new sign-in that names it acts on no organization, and it is not among theirs.
        Map<String, Object> me = given().cookie(SESSION, signIn(person, slug))
                .header("X-Mosaikit-Organization", slug)
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getMap("");
        assertThat(me.get("organization")).isNull();
        assertThat(me.get("organizationId")).isNull();
        assertThat(as(person, PASSWORD).get("/api/v1/accounts/me").jsonPath().getList("memberships.slug"))
                .doesNotContain(slug);
        // Its administrators cannot act on it.
        as(person, PASSWORD)
                .header("X-Mosaikit-Organization", slug)
                .get("/api/v1/organizations/{slug}/permissions", slug)
                .then()
                .statusCode(403);
        // A key made in it opens nothing, and is not revoked.
        given().header("Authorization", "Bearer " + key)
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(401);
        // A second suspension keeps the first reason.
        assertThat(suspend("Another reason").get("suspension"))
                .asInstanceOf(org.assertj.core.api.InstanceOfAssertFactories.MAP)
                .containsEntry("reason", "Unpaid invoices");

        asAdmin()
                .delete("/api/v1/organizations/{slug}/suspension", slug)
                .then()
                .statusCode(200)
                .body("suspended", equalTo(false))
                .body("suspension", nullValue());

        given().cookie(SESSION, signIn(person, slug))
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(200)
                .body("organization", equalTo(slug));
        given().header("Authorization", "Bearer " + key)
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(200)
                .body("organization", equalTo(slug));
    }

    @Test
    void theAuditLogOfTheOrganizationRecordsTheSuspensionAndTheReactivation() {
        signIn(person, slug);
        suspend("Asked by its owner");
        asAdmin().delete("/api/v1/organizations/{slug}/suspension", slug).then().statusCode(200);

        List<AuditEvent> events = audit.search(
                new AuditQuery(Optional.of(id), false, null, "organization.", slug, null, null, null, 0, 10));
        assertThat(events)
                .extracting(AuditEvent::getAction)
                .containsSubsequence("organization.reactivated", "organization.suspended");
        AuditEvent suspended = events.stream()
                .filter(event -> event.getAction().equals("organization.suspended"))
                .findFirst()
                .orElseThrow();
        assertThat(suspended.getActor()).isEqualTo("admin");
        assertThat(suspended.getDetail())
                .hasValueSatisfying(detail ->
                        assertThat(detail).contains("Asked by its owner").contains("\"members\":1"));
    }
}
