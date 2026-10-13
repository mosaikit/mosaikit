// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.ADMIN;
import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.response.Response;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Sessions kept by the kernel (MK-125): signing out, a suspension and the removal from an
 * organization end them at once, and people see and end their own. Each check replays a copy of the
 * cookie kept before the end, as a stolen cookie or a gateway in front of data would.
 */
@QuarkusTest
@Tag("MK-125")
class ServerSessionTest {

    private static final String SESSION = "mosaikit-session";
    private static final String REMEMBER = "mosaikit-remember";
    private static final String PASSWORD = "a long enough password";

    private String organization;
    private String person;

    @BeforeEach
    void registerAPerson() {
        organization = TestData.unique("sessions");
        person = TestData.unique("pat") + "@example.org";
        asAdmin()
                .body(Map.of("slug", organization, "name", "Acme sessions", "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        anonymous()
                .body(Map.of(
                        "organization", organization,
                        "email", person,
                        "displayName", "Pat",
                        "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
    }

    private static String signIn(String username, String password, String userAgent) {
        return given().formParam("username", username)
                .formParam("password", password)
                .header("User-Agent", userAgent)
                .post("/api/v1/accounts/session")
                .then()
                .statusCode(200)
                .extract()
                .cookie(SESSION);
    }

    private static int me(String cookie) {
        return given().cookie(SESSION, cookie).get("/api/v1/accounts/me").statusCode();
    }

    @Test
    void refusesTheCookieReplayedAfterSignOut() {
        String cookie = signIn(person, PASSWORD, "Browser A");
        assertThat(me(cookie)).isEqualTo(200);

        Response ended = given().cookie(SESSION, cookie).delete("/api/v1/accounts/session");
        ended.then().statusCode(204);
        assertThat(ended.getHeaders().getValues("Set-Cookie"))
                .anyMatch(value -> value.startsWith(SESSION + "=") && value.contains("Max-Age=0"));

        // The browser forgot the cookie; a copy of it opens nothing any more.
        assertThat(me(cookie)).isEqualTo(401);
        given().cookie(SESSION, cookie).get("/api/v1/accounts/session").then().statusCode(204);
        // A cookie that was never issued opens nothing either.
        assertThat(me("x".repeat(43))).isEqualTo(401);
    }

    @Test
    void keepsNoSecretInTheCookieAndTheSessionAcrossRequests() {
        String cookie = signIn(person, PASSWORD, "Browser A");
        // A random value, not the username: the server holds the session.
        assertThat(cookie).hasSizeGreaterThanOrEqualTo(43).doesNotContain("pat");
        for (int i = 0; i < 3; i++) {
            assertThat(me(cookie)).isEqualTo(200);
        }
    }

    @Test
    void suspensionEndsTheSessionsAndRefusesEverySignIn() {
        String cookie = signIn(person, PASSWORD, "Browser A");
        String session = given().cookie(SESSION, cookie)
                .get("/api/v1/accounts/me/sessions")
                .path("[0].id");
        String remembered = given().cookie(SESSION, cookie)
                .post("/api/v1/accounts/session/remembrance")
                .then()
                .statusCode(204)
                .extract()
                .cookie(REMEMBER);
        assertThat(session).isNotNull();

        asAdmin()
                .put("/api/v1/platform/accounts/{email}/suspension", person)
                .then()
                .statusCode(200)
                .body("suspended", equalTo(true));

        // Right after the action of the administrator, with no wait.
        assertThat(me(cookie)).isEqualTo(401);
        given().cookie(REMEMBER, remembered).get("/api/v1/accounts/me").then().statusCode(401);
        as(person, PASSWORD).get("/api/v1/accounts/me").then().statusCode(401);
        given().formParam("username", person)
                .formParam("password", PASSWORD)
                .post("/api/v1/accounts/session")
                .then()
                .statusCode(401);
        asAdmin()
                .get("/api/v1/organizations/{slug}/members", organization)
                .then()
                .body("find { it.username == '" + person + "' }.suspended", equalTo(true));
        asAdmin().get("/api/v1/audit-events?limit=20").then().body("action", hasItem("account.suspended"));

        // Reactivated, the person signs in again; the ended session stays ended.
        asAdmin()
                .delete("/api/v1/platform/accounts/{email}/suspension", person)
                .then()
                .statusCode(200)
                .body("suspended", equalTo(false));
        assertThat(me(cookie)).isEqualTo(401);
        assertThat(me(signIn(person, PASSWORD, "Browser A"))).isEqualTo(200);
    }

    @Test
    void administratorsCannotSuspendThemselvesAndOthersCannotSuspend() {
        asAdmin()
                .put("/api/v1/platform/accounts/{email}/suspension", ADMIN)
                .then()
                .statusCode(403);
        as(person, PASSWORD)
                .put("/api/v1/platform/accounts/{email}/suspension", ADMIN)
                .then()
                .statusCode(403);
        asAdmin()
                .put("/api/v1/platform/accounts/{email}/suspension", "nobody@example.org")
                .then()
                .statusCode(404);
    }

    @Test
    void removalFromTheOrganizationEndsTheSessionsInIt() {
        String cookie = signIn(person, PASSWORD, "Browser A");
        assertThat(me(cookie)).isEqualTo(200);

        asAdmin()
                .delete("/api/v1/organizations/{slug}/members/{email}", organization, person)
                .then()
                .statusCode(204);

        assertThat(me(cookie)).isEqualTo(401);
    }

    @Test
    void listsTheLiveSessionsAndEndsAnyOfThem() {
        String phone = signIn(person, PASSWORD, "Phone browser");
        String laptop = signIn(person, PASSWORD, "Laptop browser");
        String rememberedOnPhone = given().cookie(SESSION, phone)
                .post("/api/v1/accounts/session/remembrance")
                .then()
                .statusCode(204)
                .extract()
                .cookie(REMEMBER);

        List<Map<String, Object>> sessions = given().cookie(SESSION, laptop)
                .get("/api/v1/accounts/me/sessions")
                .then()
                .statusCode(200)
                .body("$", hasSize(2))
                .body("find { it.current }.userAgent", equalTo("Laptop browser"))
                .body("find { !it.current }.userAgent", equalTo("Phone browser"))
                .body("[0].createdAt", notNullValue())
                .body("[0].lastSeenAt", notNullValue())
                .body("[0].address", notNullValue())
                .body("[0].kind", equalTo("password"))
                .extract()
                .path("$");
        String phoneSession = sessions.stream()
                .filter(session -> !Boolean.TRUE.equals(session.get("current")))
                .map(session -> (String) session.get("id"))
                .findFirst()
                .orElseThrow();

        // Nobody else ends it.
        String other = TestData.unique("other") + "@example.org";
        anonymous()
                .body(Map.of(
                        "organization", organization, "email", other, "displayName", "Other", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        given().cookie(SESSION, signIn(other, PASSWORD, "Other browser"))
                .delete("/api/v1/accounts/me/sessions/{id}", phoneSession)
                .then()
                .statusCode(404);
        assertThat(me(phone)).isEqualTo(200);

        // From the laptop, the person ends the session of the phone: its cookie and its "remember me"
        // are refused at once.
        given().cookie(SESSION, laptop)
                .delete("/api/v1/accounts/me/sessions/{id}", phoneSession)
                .then()
                .statusCode(204);
        assertThat(me(phone)).isEqualTo(401);
        given().cookie(REMEMBER, rememberedOnPhone)
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(401);
        given().cookie(SESSION, laptop)
                .get("/api/v1/accounts/me/sessions")
                .then()
                .body("$", hasSize(1));
        given().cookie(SESSION, laptop)
                .delete("/api/v1/accounts/me/sessions/{id}", phoneSession)
                .then()
                .statusCode(404);

        // Ending the current one signs this browser out.
        String laptopSession = given().cookie(SESSION, laptop)
                .get("/api/v1/accounts/me/sessions")
                .path("[0].id");
        Response ended = given().cookie(SESSION, laptop).delete("/api/v1/accounts/me/sessions/{id}", laptopSession);
        ended.then().statusCode(204);
        assertThat(ended.getHeaders().getValues("Set-Cookie"))
                .anyMatch(value -> value.startsWith(SESSION + "=") && value.contains("Max-Age=0"));
        assertThat(me(laptop)).isEqualTo(401);
    }

    @Test
    void aRememberedBrowserBelongsToTheSessionItWasAskedIn() {
        String cookie = signIn(person, PASSWORD, "Browser A");
        String remembered = given().cookie(SESSION, cookie)
                .post("/api/v1/accounts/session/remembrance")
                .then()
                .statusCode(204)
                .extract()
                .cookie(REMEMBER);

        // The browser was closed: only "remember me" is left, in the same session, marked current.
        given().cookie(REMEMBER, remembered)
                .get("/api/v1/accounts/me/sessions")
                .then()
                .statusCode(200)
                .body("$", hasSize(1))
                .body("[0].current", equalTo(true));

        // Signing out from there ends the session: the copy of the session cookie is refused too.
        given().cookie(REMEMBER, remembered)
                .delete("/api/v1/accounts/session")
                .then()
                .statusCode(204);
        assertThat(me(cookie)).isEqualTo(401);
        given().cookie(REMEMBER, remembered).get("/api/v1/accounts/me").then().statusCode(401);
    }

    @Test
    void needsASignedInPersonForTheList() {
        given().get("/api/v1/accounts/me/sessions").then().statusCode(401);
        // HTTP Basic opens no session: the list holds the sessions of the shell only.
        as(person, PASSWORD)
                .get("/api/v1/accounts/me/sessions")
                .then()
                .statusCode(200)
                .body("$", hasSize(0));
    }
}
