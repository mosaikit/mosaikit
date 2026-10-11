// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.ADMIN;
import static dev.mosaikit.kernel.app.Credentials.ADMIN_PASSWORD;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.response.Response;
import java.util.List;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** "Remember me" at the sign-in of the shell: signed in again when the session of the browser ended. */
@QuarkusTest
@Tag("MK-047")
class RememberMeTest {

    private static final String SESSION = "mosaikit-session";
    private static final String REMEMBER = "mosaikit-remember";

    private static String remembered() {
        String session = given().formParam("username", ADMIN)
                .formParam("password", ADMIN_PASSWORD)
                .post("/api/v1/accounts/session")
                .then()
                .statusCode(200)
                .extract()
                .cookie(SESSION);
        Response remembered = given().cookie(SESSION, session).post("/api/v1/accounts/session/remembrance");
        remembered.then().statusCode(204);
        String header = remembered.getHeaders().getValues("Set-Cookie").stream()
                .filter(value -> value.startsWith(REMEMBER + "="))
                .findFirst()
                .orElseThrow();
        // 30 days by default, out of reach of scripts and of other sites.
        assertThat(header)
                .containsIgnoringCase("HttpOnly")
                .containsIgnoringCase("SameSite=Strict")
                .contains("Max-Age=2592000");
        return remembered.getCookie(REMEMBER);
    }

    @Test
    void signsInAgainWithoutTheSessionUntilSignOut() {
        String token = remembered();
        assertThat(token).hasSizeGreaterThanOrEqualTo(43);

        // The browser was closed: only the cookie of "remember me" is left.
        given().cookie(REMEMBER, token)
                .get("/api/v1/accounts/session")
                .then()
                .statusCode(200)
                .body("username", equalTo(ADMIN));
        given().cookie(REMEMBER, token).get("/api/v1/accounts/me").then().statusCode(200);

        Response ended = given().cookie(REMEMBER, token).delete("/api/v1/accounts/session");
        ended.then().statusCode(204);
        List<String> cleared = ended.getHeaders().getValues("Set-Cookie");
        assertThat(cleared).anyMatch(value -> value.startsWith(REMEMBER + "=;") && value.contains("Max-Age=0"));

        // A copy of the cookie kept after the sign-out signs nobody in.
        given().cookie(REMEMBER, token).get("/api/v1/accounts/session").then().statusCode(204);
    }

    @Test
    void ignoresUnknownTokensAndRemembersOnlySignedInPeople() {
        given().cookie(REMEMBER, "not-a-token")
                .get("/api/v1/accounts/session")
                .then()
                .statusCode(204);
        given().cookie(REMEMBER, "x".repeat(500))
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(401);
        given().post("/api/v1/accounts/session/remembrance").then().statusCode(401);
    }
}
