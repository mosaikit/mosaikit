// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.AdminCreatedAccountTest.PASSWORD;
import static dev.mosaikit.kernel.app.AdminCreatedAccountTest.account;
import static dev.mosaikit.kernel.app.AdminCreatedAccountTest.in;
import static dev.mosaikit.kernel.app.AdminCreatedAccountTest.organization;
import static dev.mosaikit.kernel.app.AdminCreatedAccountTest.register;
import static dev.mosaikit.kernel.app.AdminCreatedAccountTest.setPassword;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.notNullValue;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Accounts that administrators create (MK-048) on an installation that sends no mail: the link that
 * sets the password is returned once to the administrator, who passes it on.
 */
@QuarkusTest
@TestProfile(AdminCreatedAccountWithoutMailTest.WithoutMail.class)
@Tag("MK-048")
class AdminCreatedAccountWithoutMailTest {

    /** No mail server named, and no mock mailer. */
    public static class WithoutMail implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of("quarkus.mailer.mock", "false");
        }
    }

    private static String tokenOf(String link) {
        return link.substring(link.indexOf("set-password=") + "set-password=".length());
    }

    @Test
    @Tag("MK-047")
    void theLinkIsReturnedOnceAndThePersonSignsInAfterSettingThePassword() {
        String acme = organization();
        String boss = register(acme);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", acme, boss)
                .then()
                .statusCode(200);

        String email = unique("luigi") + "@example.org";
        String link = in(boss, acme)
                .body(account(email, "Luigi", List.of()))
                .post("/api/v1/organizations/{slug}/accounts", acme)
                .then()
                .statusCode(201)
                .body("mailed", equalTo(false))
                .body("link", matchesPattern("https?://\\S+/\\?set-password=[A-Za-z0-9_-]{43}"))
                .body("expiresAt", notNullValue())
                .extract()
                .path("link");
        String token = tokenOf(link);

        // Never again: the member list does not carry it.
        String members = in(boss, acme)
                .get("/api/v1/organizations/{slug}/members", acme)
                .then()
                .statusCode(200)
                .extract()
                .asString();
        assertThat(members).doesNotContain(token);

        // A new link replaces it, returned once too.
        String second = in(boss, acme)
                .post("/api/v1/organizations/{slug}/accounts/{email}/password-link", acme, email)
                .then()
                .statusCode(200)
                .body("mailed", equalTo(false))
                .extract()
                .path("link");
        assertThat(second).isNotEqualTo(link);
        String secondToken = tokenOf(second);

        as(email, PASSWORD).get("/api/v1/accounts/me").then().statusCode(401);
        setPassword(token, 404);
        setPassword(secondToken, 204);
        as(email, PASSWORD).get("/api/v1/accounts/me").then().statusCode(200).body("username", equalTo(email));
        setPassword(secondToken, 404);
    }
}
