// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.ADMIN;
import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;

import io.quarkus.test.junit.QuarkusTest;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * What the console of platform administrators shows and does about suspensions (MK-125): the status
 * of an account with when, by whom and why it was suspended, the list of suspended accounts, and the
 * reason kept in the audit log.
 */
@QuarkusTest
@Tag("MK-125")
class AccountSuspensionTest {

    private static final String PASSWORD = "a long enough password";

    private String person;

    @BeforeEach
    void registerAPerson() {
        String organization = TestData.unique("suspension");
        person = TestData.unique("sam") + "@example.org";
        asAdmin()
                .body(Map.of("slug", organization, "name", "Acme suspension", "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        anonymous()
                .body(Map.of("organization", organization, "email", person, "displayName", "Sam", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
    }

    @Test
    void showsTheStatusWithTheReasonAndAuditsIt() {
        asAdmin()
                .get("/api/v1/platform/accounts/{email}/suspension", person)
                .then()
                .statusCode(200)
                .body("username", equalTo(person))
                .body("displayName", equalTo("Sam"))
                .body("suspended", equalTo(false))
                .body("reason", nullValue());

        asAdmin()
                .body(Map.of("reason", "  Laptop reported stolen  "))
                .put("/api/v1/platform/accounts/{email}/suspension", person)
                .then()
                .statusCode(200)
                .body("suspended", equalTo(true))
                .body("reason", equalTo("Laptop reported stolen"))
                .body("suspendedBy", equalTo(ADMIN))
                .body("suspendedAt", notNullValue());

        asAdmin()
                .get("/api/v1/platform/accounts/{email}/suspension", person)
                .then()
                .body("suspended", equalTo(true))
                .body("reason", equalTo("Laptop reported stolen"));
        asAdmin()
                .get("/api/v1/platform/accounts/suspended")
                .then()
                .statusCode(200)
                .body("find { it.username == '" + person + "' }.reason", equalTo("Laptop reported stolen"));
        asAdmin()
                .get("/api/v1/audit-events?limit=20")
                .then()
                .body(
                        "find { it.action == 'account.suspended' && it.subject == '" + person + "' }.detail",
                        containsString("Laptop reported stolen"));

        // Suspended again, it keeps the first reason.
        asAdmin()
                .body(Map.of("reason", "Another reason"))
                .put("/api/v1/platform/accounts/{email}/suspension", person)
                .then()
                .body("reason", equalTo("Laptop reported stolen"));

        // Reactivated, the reason goes; the audit log keeps it.
        asAdmin()
                .delete("/api/v1/platform/accounts/{email}/suspension", person)
                .then()
                .statusCode(200)
                .body("suspended", equalTo(false))
                .body("reason", nullValue())
                .body("suspendedBy", nullValue());
        asAdmin().get("/api/v1/platform/accounts/suspended").then().body("username", not(hasItem(person)));
        asAdmin().get("/api/v1/audit-events?limit=20").then().body("action", hasItem("account.reactivated"));
    }

    @Test
    void suspendsWithoutAReasonAndRefusesOneTooLong() {
        asAdmin()
                .body(Map.of("reason", "x".repeat(501)))
                .put("/api/v1/platform/accounts/{email}/suspension", person)
                .then()
                .statusCode(400);
        asAdmin()
                .get("/api/v1/platform/accounts/{email}/suspension", person)
                .then()
                .body("suspended", equalTo(false));

        asAdmin()
                .put("/api/v1/platform/accounts/{email}/suspension", person)
                .then()
                .statusCode(200)
                .body("suspended", equalTo(true))
                .body("reason", nullValue());
        asAdmin().delete("/api/v1/platform/accounts/{email}/suspension", person);
    }

    @Test
    void onlyPlatformAdministratorsReadSuspensions() {
        as(person, PASSWORD).get("/api/v1/platform/accounts/suspended").then().statusCode(403);
        as(person, PASSWORD)
                .get("/api/v1/platform/accounts/{email}/suspension", person)
                .then()
                .statusCode(403);
        asAdmin()
                .get("/api/v1/platform/accounts/{email}/suspension", "nobody@example.org")
                .then()
                .statusCode(404);
    }
}
