// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;

import io.quarkus.mailer.Mail;
import io.quarkus.mailer.MockMailbox;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** Self-registration with the confirmation of the email address, which administrators turn off. */
@QuarkusTest
@TestProfile(RegistrationTest.Confirmed.class)
@Tag("MK-048")
class RegistrationTest {

    static final String ORGANIZATION = "registration-town";
    static final String PASSWORD = "a long enough password";
    static final Pattern LINK = Pattern.compile("https?://\\S+/\\?confirm=([A-Za-z0-9_-]+)");

    /** Registrations confirmed by mail, as in installations. */
    public static class Confirmed implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of("mosaikit.accounts.confirm-email", "true");
        }
    }

    @Inject
    MockMailbox mailbox;

    @BeforeEach
    void open() {
        asAdmin()
                .body(Map.of("registration", true))
                .put("/api/v1/platform/settings")
                .then()
                .statusCode(200);
        asAdmin()
                .body(Map.of("slug", ORGANIZATION, "name", "Registration Town", "selfRegistration", true))
                .post("/api/v1/organizations");
        mailbox.clear();
    }

    private static String register(String email) {
        anonymous()
                .body(Map.of(
                        "organization", ORGANIZATION, "email", email, "displayName", "Luigi", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(202)
                .body("confirmation", equalTo("sent"));
        return email;
    }

    private String tokenSentTo(String email) {
        List<Mail> mails = mailbox.getMailsSentTo(email);
        assertThat(mails).isNotEmpty();
        Mail last = mails.getLast();
        assertThat(last.getSubject()).isEqualTo("Confirm your email address");
        Matcher link = LINK.matcher(last.getText());
        assertThat(link.find()).as("a link in %s", last.getText()).isTrue();
        assertThat(last.getHtml()).contains(link.group());
        return link.group(1);
    }

    private static void confirm(String token, int status) {
        anonymous()
                .body(Map.of("token", token))
                .post("/api/v1/accounts/confirmations")
                .then()
                .statusCode(status);
    }

    @Test
    void signsInOnlyAfterTheLinkSentToTheAddressIsOpened() {
        String email = register(unique("luigi") + "@example.org");
        as(email, PASSWORD).get("/api/v1/accounts/me").then().statusCode(401);

        String token = tokenSentTo(email);
        confirm(token, 204);

        as(email, PASSWORD).get("/api/v1/accounts/me").then().statusCode(200).body("username", equalTo(email));
        // A link works once.
        confirm(token, 404);
        confirm("not-a-token", 404);
    }

    @Test
    void sendsANewLinkThatReplacesThePreviousOne() {
        String email = register(unique("maria") + "@example.org");
        String first = tokenSentTo(email);

        anonymous()
                .body(Map.of("email", email))
                .post("/api/v1/accounts/confirmations/requests")
                .then()
                .statusCode(202);
        String second = tokenSentTo(email);
        assertThat(second).isNotEqualTo(first);
        confirm(first, 404);
        confirm(second, 204);

        // Nobody learns which addresses have an account, or are confirmed already.
        mailbox.clear();
        for (String address : new String[] {"nobody@example.org", email}) {
            anonymous()
                    .body(Map.of("email", address))
                    .post("/api/v1/accounts/confirmations/requests")
                    .then()
                    .statusCode(202);
        }
        assertThat(mailbox.getTotalMessagesSent()).isZero();
    }

    @Test
    void isOffWhenTheAdministratorTurnsItOff() {
        anonymous()
                .get("/api/v1/accounts/registration-options")
                .then()
                .statusCode(200)
                .body("enabled", equalTo(true))
                .body("organizations.slug", hasItem(ORGANIZATION));

        asAdmin()
                .body(Map.of("registration", false))
                .put("/api/v1/platform/settings")
                .then()
                .statusCode(200)
                .body("registration", equalTo(false));

        anonymous()
                .get("/api/v1/accounts/registration-options")
                .then()
                .body("enabled", equalTo(false))
                .body("organizations", equalTo(List.of()));
        anonymous()
                .body(Map.of(
                        "organization",
                        ORGANIZATION,
                        "email",
                        unique("off") + "@example.org",
                        "displayName",
                        "Off",
                        "password",
                        PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(403);
        assertThat(mailbox.getTotalMessagesSent()).isZero();
        asAdmin().get("/api/v1/audit-events?limit=20").then().body("action", hasItem("platform.settings.changed"));
    }

    @Test
    void letsOnlyPlatformAdministratorsChangeTheSettings() {
        String email = register(unique("anna") + "@example.org");
        confirm(tokenSentTo(email), 204);

        as(email, PASSWORD).get("/api/v1/platform/settings").then().statusCode(403);
        as(email, PASSWORD)
                .body(Map.of("registration", false))
                .put("/api/v1/platform/settings")
                .then()
                .statusCode(403);
        anonymous().get("/api/v1/platform/settings").then().statusCode(401);
        asAdmin().body(Map.of()).put("/api/v1/platform/settings").then().statusCode(400);
    }
}
