// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.not;

import io.quarkus.test.junit.QuarkusTest;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@QuarkusTest
@Tag("MK-003")
class AccountResourceTest {

    private static final String OPEN = "open-registration";
    private static final String CLOSED = "closed-registration";
    private static final String PASSWORD = "a long enough password";

    /** Shared prerequisites: created once, then the call answers 409, which is fine. */
    @BeforeEach
    void createOrganizations() {
        for (var slug : new String[] {OPEN, CLOSED}) {
            asAdmin()
                    .body(Map.of("slug", slug, "name", slug, "selfRegistration", slug.equals(OPEN)))
                    .post("/api/v1/organizations");
        }
    }

    private static Map<String, String> registration(String organization, String email, String password) {
        return Map.of(
                "organization", organization, "email", email, "displayName", "Ada Lovelace", "password", password);
    }

    @Test
    void registersAndSignsInWithALocalAccount() {
        var name = unique("ada");
        anonymous()
                .body(registration(OPEN, name.toUpperCase() + "@Example.org", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201)
                .body("username", equalTo(name + "@example.org"))
                .body("roles", contains("organization-user"))
                .body("$", not(hasKey("passwordHash")));

        as(name + "@example.org", PASSWORD)
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(200)
                .body("displayName", equalTo("Ada Lovelace"));
    }

    @Test
    void refusesAWrongPassword() {
        var email = unique("grace") + "@example.org";
        anonymous().body(registration(OPEN, email, PASSWORD)).post("/api/v1/accounts/registrations");

        as(email, "not the right password").get("/api/v1/accounts/me").then().statusCode(401);
        as(unique("nobody") + "@example.org", PASSWORD)
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(401);
    }

    @Test
    void refusesRegistrationWhereItIsNotAllowed() {
        anonymous()
                .body(registration(CLOSED, unique("alan") + "@example.org", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(403)
                .body("title", equalTo("Operation not allowed"));
    }

    @Test
    void refusesADuplicateEmail() {
        var name = unique("edsger");
        anonymous()
                .body(registration(OPEN, name + "@example.org", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);

        anonymous()
                .body(registration(OPEN, name.toUpperCase() + "@example.org", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(409);
    }

    @Test
    void enforcesThePasswordPolicy() {
        anonymous()
                .body(registration(OPEN, "short@example.org", "too short"))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(400)
                .body("errors.field", hasItem("password"));
    }

    @Test
    void createsThePlatformAdministratorAtFirstStart() {
        asAdmin().get("/api/v1/accounts/me").then().statusCode(200).body("roles", contains("platform-admin"));
    }

    @Test
    void keepsAdministrationForThePlatformAdministrator() {
        var email = unique("barbara") + "@example.org";
        anonymous().body(registration(OPEN, email, PASSWORD)).post("/api/v1/accounts/registrations");

        as(email, PASSWORD).get("/api/v1/organizations").then().statusCode(403);
    }
}
