// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.ADMIN;
import static dev.mosaikit.kernel.app.Credentials.ADMIN_PASSWORD;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.response.Response;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The session of the shell for local accounts: a reload must not sign the person out. */
@QuarkusTest
@Tag("MK-008")
class SessionTest {

    private static final String COOKIE = "mosaikit-session";

    private static Response signIn(String password) {
        return given().formParam("username", ADMIN)
                .formParam("password", password)
                .post("/api/v1/accounts/session");
    }

    @Test
    void keepsTheSessionInAnHttpOnlyCookie() {
        Response signedIn = signIn(ADMIN_PASSWORD);
        signedIn.then().statusCode(200);
        String cookie = signedIn.getCookie(COOKIE);
        assertThat(cookie).isNotBlank();
        String header = signedIn.getHeader("Set-Cookie");
        // Attribute names of cookies are case-insensitive (Quarkus writes "HTTPOnly").
        assertThat(header).containsIgnoringCase("HttpOnly").containsIgnoringCase("SameSite=Strict");

        // A reload of the shell finds the session again, without any password.
        given().cookie(COOKIE, cookie)
                .get("/api/v1/accounts/session")
                .then()
                .statusCode(200)
                .body("username", equalTo(ADMIN))
                .body("roles", contains("platform-admin"));
        given().cookie(COOKIE, cookie).get("/api/v1/accounts/me").then().statusCode(200);
    }

    @Test
    void refusesAWrongPasswordWithoutRedirecting() {
        Response refused = signIn("wrong password");
        refused.then().statusCode(401);
        assertThat(refused.getCookie(COOKIE)).isNull();
    }

    @Test
    void hasNoSessionWhenSignedOut() {
        given().get("/api/v1/accounts/session").then().statusCode(204);

        Response ended = given().delete("/api/v1/accounts/session");
        ended.then().statusCode(204);
        assertThat(ended.getHeaders().getValues("Set-Cookie"))
                .anyMatch(value -> value.startsWith(COOKIE + "=") && value.contains("Max-Age=0"));
    }

    @Test
    void neverAsksTheBrowserForAPasswordOnBehalfOfTheShell() {
        Response shell = given().header("X-Mosaikit-Client", "shell").get("/api/v1/accounts/me");
        shell.then().statusCode(401);
        assertThat(shell.getHeader("WWW-Authenticate")).isNull();
    }
}
