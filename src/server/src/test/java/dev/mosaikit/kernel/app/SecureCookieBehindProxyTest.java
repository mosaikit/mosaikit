// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.ADMIN;
import static dev.mosaikit.kernel.app.Credentials.ADMIN_PASSWORD;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Behind a reverse proxy that terminates TLS (issue #97), the cookies of the kernel carry {@code
 * Secure} when the trusted proxy forwards {@code X-Forwarded-Proto: https}: the session of the shell
 * (MK-125), "remember me" (MK-047) and the cookies that sign-out, or ending the current session in
 * the settings (issue #124), deletes. A plain HTTP request
 * without the header gets them without {@code Secure}, so that an installation reached over HTTP
 * keeps working.
 */
@QuarkusTest
@TestProfile(SecureCookieBehindProxyTest.TrustedProxy.class)
@Tag("MK-125")
@Tag("MK-047")
class SecureCookieBehindProxyTest {

    static final String SESSION = "mosaikit-session";
    static final String REMEMBER = "mosaikit-remember";
    private static final Pattern SECURE = Pattern.compile("(?i);\s*Secure\s*(;|$)");

    /** Forwarded headers on, from the address of the tests only: the proxy of the tests. */
    public static class TrustedProxy implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of(
                    "quarkus.http.proxy.proxy-address-forwarding", "true",
                    "quarkus.http.proxy.allow-x-forwarded", "true",
                    "quarkus.http.proxy.trusted-proxies", "127.0.0.0/8,::1");
        }
    }

    /** The Set-Cookie header of the answer for this cookie. */
    static String setCookie(Response response, String name) {
        List<String> headers = response.getHeaders().getValues("Set-Cookie");
        return headers.stream()
                .filter(value -> value.startsWith(name + "="))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no cookie " + name + " in " + headers));
    }

    static boolean secure(String setCookie) {
        return SECURE.matcher(setCookie).find();
    }

    static RequestSpecification request(boolean forwardedHttps) {
        RequestSpecification request = given();
        return forwardedHttps ? request.header("X-Forwarded-Proto", "https") : request;
    }

    /** Signs in, asks to be remembered and signs out, and tells whether each cookie carries Secure. */
    static List<Boolean> cookies(boolean forwardedHttps) {
        Response opened = request(forwardedHttps)
                .formParam("username", ADMIN)
                .formParam("password", ADMIN_PASSWORD)
                .post("/api/v1/accounts/session");
        opened.then().statusCode(200);
        String session = opened.getCookie(SESSION);
        String sessionCookie = setCookie(opened, SESSION);
        assertThat(sessionCookie).containsIgnoringCase("HttpOnly").containsIgnoringCase("SameSite=Strict");

        Response remembered =
                request(forwardedHttps).cookie(SESSION, session).post("/api/v1/accounts/session/remembrance");
        remembered.then().statusCode(204);
        String token = remembered.getCookie(REMEMBER);

        Response ended = request(forwardedHttps)
                .cookie(SESSION, session)
                .cookie(REMEMBER, token)
                .delete("/api/v1/accounts/session");
        ended.then().statusCode(204);
        return List.of(
                secure(sessionCookie),
                secure(setCookie(remembered, REMEMBER)),
                secure(setCookie(ended, SESSION)),
                secure(setCookie(ended, REMEMBER)));
    }

    /**
     * Signs in and ends the current session from the settings, and tells whether each deleted cookie
     * carries Secure.
     */
    static List<Boolean> cookiesEndedInSettings(boolean forwardedHttps) {
        Response opened = request(forwardedHttps)
                .formParam("username", ADMIN)
                .formParam("password", ADMIN_PASSWORD)
                .post("/api/v1/accounts/session");
        opened.then().statusCode(200);
        String session = opened.getCookie(SESSION);
        String current = request(forwardedHttps)
                .cookie(SESSION, session)
                .get("/api/v1/accounts/me/sessions")
                .then()
                .statusCode(200)
                .extract()
                .path("find { it.current }.id");
        Response ended =
                request(forwardedHttps).cookie(SESSION, session).delete("/api/v1/accounts/me/sessions/{id}", current);
        ended.then().statusCode(204);
        return List.of(secure(setCookie(ended, SESSION)), secure(setCookie(ended, REMEMBER)));
    }

    @Test
    void endingTheCurrentSessionInTheSettingsDeletesSecureCookiesBehindHttps() {
        assertThat(cookiesEndedInSettings(true)).containsExactly(true, true);
    }

    @Test
    void endingTheCurrentSessionInTheSettingsOverPlainHttpDeletesCookiesWithoutSecure() {
        assertThat(cookiesEndedInSettings(false)).containsExactly(false, false);
    }

    @Test
    void cookiesAreSecureWhenTheTrustedProxyForwardsHttps() {
        assertThat(cookies(true)).containsExactly(true, true, true, true);
    }

    @Test
    void cookiesAreNotSecureOverPlainHttp() {
        assertThat(cookies(false)).containsExactly(false, false, false, false);
    }

    @Test
    void theStandardForwardedHeaderIsIgnoredWhenOnlyXForwardedIsAllowed() {
        Response opened = given().header("Forwarded", "proto=https")
                .formParam("username", ADMIN)
                .formParam("password", ADMIN_PASSWORD)
                .post("/api/v1/accounts/session");
        opened.then().statusCode(200);
        assertThat(secure(setCookie(opened, SESSION))).isFalse();
    }
}
