// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.KeycloakTestResource.ACME;
import static dev.mosaikit.kernel.app.KeycloakTestResource.GLOBEX;
import static dev.mosaikit.kernel.app.KeycloakTestResource.email;
import static dev.mosaikit.kernel.app.KeycloakTestResource.token;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.nullValue;

import io.quarkus.test.common.WithTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.specification.RequestSpecification;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Membership of several organizations (MK-017): acme accepts passwords and its realm, globex
 * requires its realm. dave and erin have local accounts in acme; the realm of globex knows both.
 */
@QuarkusTest
@WithTestResource(KeycloakTestResource.class)
@Tag("keycloak")
@Tag("MK-017")
class MembershipTest {

    private static final String PASSWORD = "a long enough password";
    private static final String DAVE = email("dave", ACME);
    private static final String ERIN = email("erin", ACME);

    @BeforeEach
    void createOrganizations() {
        for (String realm : List.of(ACME, GLOBEX)) {
            asAdmin()
                    .body(Map.of("slug", realm, "name", realm, "selfRegistration", true))
                    .post("/api/v1/organizations");
        }
        asAdmin()
                .body(Map.of("realm", ACME, "emailDomains", List.of(ACME + ".test")))
                .put("/api/v1/organizations/{slug}/identity", ACME)
                .then()
                .statusCode(200)
                .body("signIn", equalTo("password-or-realm"));
        asAdmin()
                .body(Map.of("realm", GLOBEX, "emailDomains", List.of(GLOBEX + ".test"), "signIn", "realm"))
                .put("/api/v1/organizations/{slug}/identity", GLOBEX)
                .then()
                .statusCode(200)
                .body("signIn", equalTo("realm"));
        for (String person : List.of(DAVE, ERIN)) {
            anonymous()
                    .body(Map.of("organization", ACME, "email", person, "displayName", "Local", "password", PASSWORD))
                    .post("/api/v1/accounts/registrations");
        }
    }

    private static RequestSpecification bearer(String token) {
        return given().auth().oauth2(token);
    }

    private static String id(String slug) {
        return asAdmin().get("/api/v1/organizations/{slug}", slug).path("id");
    }

    @Test
    void addsALocalAccountToASecondOrganizationThatItEntersThroughItsRealm() {
        asAdmin()
                .body(Map.of("roles", List.of("organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", GLOBEX, DAVE)
                .then()
                .statusCode(200)
                .body("username", equalTo(DAVE))
                .body("linked", equalTo(false))
                .body("password", equalTo(true));
        String localId = as(DAVE, PASSWORD).get("/api/v1/accounts/me").path("id");

        bearer(token(GLOBEX, "dave"))
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(200)
                .body("id", equalTo(localId))
                .body("organizationId", equalTo(id(GLOBEX)))
                .body("organization", equalTo(GLOBEX))
                .body("roles", containsInAnyOrder("organization-user"))
                .body("memberships.slug", containsInAnyOrder(ACME, GLOBEX));
        asAdmin()
                .get("/api/v1/organizations/{slug}/members", GLOBEX)
                .then()
                .statusCode(200)
                .body("find { it.username == '" + DAVE + "' }.linked", equalTo(true));
    }

    @Test
    void refusesARealmThatClaimsAnAccountWhichIsNotItsMember() {
        bearer(token(GLOBEX, "erin")).get("/api/v1/accounts/me").then().statusCode(401);
    }

    @Test
    void actsOnOneOrganizationOfThePersonAtATime() {
        asAdmin()
                .body(Map.of())
                .put("/api/v1/organizations/{slug}/members/{email}", GLOBEX, DAVE)
                .then()
                .statusCode(200);

        // With a password dave acts on acme, his only organization that accepts passwords.
        as(DAVE, PASSWORD)
                .get("/api/v1/test/current-organization")
                .then()
                .statusCode(200)
                .body("slug", equalTo(ACME));
        as(DAVE, PASSWORD)
                .header("X-Mosaikit-Organization", ACME)
                .get("/api/v1/test/current-organization")
                .then()
                .body("id", equalTo(id(ACME)));
        // Through the realm of globex he acts on globex, never on acme.
        bearer(token(GLOBEX, "dave"))
                .header("X-Mosaikit-Organization", ACME)
                .get("/api/v1/test/current-organization")
                .then()
                .statusCode(200)
                .body("slug", equalTo(GLOBEX));
        // An organization of which the person is not a member is never chosen.
        as(ERIN, PASSWORD)
                .header("X-Mosaikit-Organization", GLOBEX)
                .get("/api/v1/test/current-organization")
                .then()
                .statusCode(403);
    }

    @Test
    void anOrganizationThatRequiresItsRealmRefusesPasswords() {
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", GLOBEX, DAVE)
                .then()
                .statusCode(200);

        as(DAVE, PASSWORD)
                .header("X-Mosaikit-Organization", GLOBEX)
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(200)
                .body("organizationId", nullValue())
                .body("roles", containsInAnyOrder())
                .body("memberships.find { it.slug == '" + GLOBEX + "' }.signIn", equalTo("realm"));
        as(DAVE, PASSWORD)
                .header("X-Mosaikit-Organization", GLOBEX)
                .get("/api/v1/test/current-organization")
                .then()
                .statusCode(403);
        // The same person keeps signing in with a password to acme.
        as(DAVE, PASSWORD)
                .header("X-Mosaikit-Organization", ACME)
                .get("/api/v1/accounts/me")
                .then()
                .body("organization", equalTo(ACME))
                .body("roles", hasItem("organization-user"));
        // No self-registration with a password in an organization that requires its realm.
        anonymous()
                .body(Map.of(
                        "organization",
                        GLOBEX,
                        "email",
                        "x@" + GLOBEX + ".test",
                        "displayName",
                        "X",
                        "password",
                        PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(403);
    }

    @Test
    void managesTheMembersOfAnOrganization() {
        String newcomer = TestData.unique("newcomer") + "@example.org";

        asAdmin()
                .body(Map.of("displayName", "New Comer"))
                .put("/api/v1/organizations/{slug}/members/{email}", ACME, newcomer)
                .then()
                .statusCode(200)
                .body("displayName", equalTo("New Comer"))
                .body("roles", containsInAnyOrder("organization-user"))
                .body("password", equalTo(false));
        asAdmin()
                .body(Map.of("roles", List.of("platform-admin")))
                .put("/api/v1/organizations/{slug}/members/{email}", ACME, newcomer)
                .then()
                .statusCode(403);
        asAdmin()
                .delete("/api/v1/organizations/{slug}/members/{email}", ACME, newcomer)
                .then()
                .statusCode(204);
        asAdmin()
                .delete("/api/v1/organizations/{slug}/members/{email}", ACME, newcomer)
                .then()
                .statusCode(404);
        as(DAVE, PASSWORD)
                .get("/api/v1/organizations/{slug}/members", ACME)
                .then()
                .statusCode(403);
    }

    @Test
    void platformRolesNeedAPassword() {
        asAdmin().get("/api/v1/accounts/me").then().body("roles", containsInAnyOrder("platform-admin"));
        asAdmin().get("/api/v1/test/current-organization").then().statusCode(403);
    }
}
