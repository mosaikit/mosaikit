// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.nullValue;

import io.quarkus.mailer.Mail;
import io.quarkus.mailer.MockMailbox;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Accounts that administrators create for people (MK-048), on an installation that sends mail (the
 * mock mailer of the tests): the link that sets the password goes to the person, never back to the
 * administrator.
 */
@QuarkusTest
@Tag("MK-048")
class AdminCreatedAccountTest {

    static final String PASSWORD = "a long enough password";
    static final Pattern LINK = Pattern.compile("https?://\\S+/\\?set-password=([A-Za-z0-9_-]+)");

    @Inject
    MockMailbox mailbox;

    private String acme;
    private String globex;
    private String boss;
    private String ada;

    @BeforeEach
    void organizations() {
        acme = organization();
        globex = organization();
        boss = register(acme);
        ada = register(acme);
        register(globex);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", acme, boss)
                .then()
                .statusCode(200);
    }

    static String organization() {
        String slug = unique("accounts");
        asAdmin()
                .body(Map.of("slug", slug, "name", "Acme " + slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    static String register(String organization) {
        String email = unique("accounts") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    static Map<String, Object> account(String email, String name, List<String> roles) {
        return Map.of("email", email, "displayName", name, "roles", roles);
    }

    private String tokenMailedTo(String email) {
        List<Mail> mails = mailbox.getMailsSentTo(email);
        assertThat(mails).isNotEmpty();
        Mail last = mails.getLast();
        assertThat(last.getSubject()).isEqualTo("Choose the password of your account");
        Matcher link = LINK.matcher(last.getText());
        assertThat(link.find()).as("a link in %s", last.getText()).isTrue();
        assertThat(last.getHtml()).contains(link.group());
        return link.group(1);
    }

    static void setPassword(String token, int status) {
        anonymous()
                .body(Map.of("token", token, "password", PASSWORD))
                .post("/api/v1/accounts/passwords")
                .then()
                .statusCode(status);
    }

    @Test
    void anAdministratorOfTheOrganizationCreatesAnAccountWhoseLinkIsMailed() {
        String email = unique("luigi") + "@example.org";
        in(boss, acme)
                .body(account(email, "Luigi Verdi", List.of("organization-user")))
                .post("/api/v1/organizations/{slug}/accounts", acme)
                .then()
                .statusCode(201)
                .body("member.username", equalTo(email))
                .body("member.displayName", equalTo("Luigi Verdi"))
                .body("member.roles", containsInAnyOrder("organization-user"))
                .body("member.password", equalTo(false))
                .body("mailed", equalTo(true))
                // With mail, the link goes to the person only.
                .body("link", nullValue());

        String token = tokenMailedTo(email);
        assertThat(mailbox.getMailsSentTo(email).getLast().getText()).contains("Acme " + acme);
        // The member list shows the account, without a password yet.
        in(boss, acme)
                .get("/api/v1/organizations/{slug}/members", acme)
                .then()
                .statusCode(200)
                .body("find { it.username == '" + email + "' }.password", equalTo(false));
        setPassword(token, 204);
        as(email, PASSWORD).get("/api/v1/accounts/me").then().statusCode(200);
    }

    @Test
    @Tag("MK-047")
    void thePersonSignsInOnlyAfterSettingThePasswordAndTheLinkWorksOnce() {
        String email = unique("maria") + "@example.org";
        in(boss, acme)
                .body(account(email, "Maria", List.of()))
                .post("/api/v1/organizations/{slug}/accounts", acme)
                .then()
                .statusCode(201);
        String token = tokenMailedTo(email);
        as(email, PASSWORD).get("/api/v1/accounts/me").then().statusCode(401);

        // The same policy as registration: a short password is refused, and the link still works.
        anonymous()
                .body(Map.of("token", token, "password", "short"))
                .post("/api/v1/accounts/passwords")
                .then()
                .statusCode(400);
        setPassword(token, 204);
        as(email, PASSWORD).get("/api/v1/accounts/me").then().statusCode(200).body("username", equalTo(email));
        // A link works once.
        setPassword(token, 404);
        setPassword("not-a-token", 404);
        // Once the password is set, no new link.
        in(boss, acme)
                .post("/api/v1/organizations/{slug}/accounts/{email}/password-link", acme, email)
                .then()
                .statusCode(409);
    }

    @Test
    void aNewLinkReplacesThePreviousOne() {
        String email = unique("bea") + "@example.org";
        in(boss, acme)
                .body(account(email, "Bea", List.of()))
                .post("/api/v1/organizations/{slug}/accounts", acme)
                .then()
                .statusCode(201);
        String first = tokenMailedTo(email);
        in(boss, acme)
                .post("/api/v1/organizations/{slug}/accounts/{email}/password-link", acme, email)
                .then()
                .statusCode(200)
                .body("mailed", equalTo(true))
                .body("link", nullValue());
        String second = tokenMailedTo(email);
        assertThat(second).isNotEqualTo(first);
        setPassword(first, 404);
        setPassword(second, 204);
    }

    @Test
    void anAdministratorOfTheOrganizationCreatesAccountsInTheirOrganizationOnly() {
        String email = unique("x") + "@example.org";
        // Another organization, even when named in the request.
        in(boss, acme)
                .body(account(email, "X", List.of()))
                .post("/api/v1/organizations/{slug}/accounts", globex)
                .then()
                .statusCode(403);
        in(boss, globex)
                .body(account(email, "X", List.of()))
                .post("/api/v1/organizations/{slug}/accounts", globex)
                .then()
                .statusCode(403);
        // Members are refused.
        in(ada, acme)
                .body(account(email, "X", List.of()))
                .post("/api/v1/organizations/{slug}/accounts", acme)
                .then()
                .statusCode(403);
        anonymous()
                .body(account(email, "X", List.of()))
                .post("/api/v1/organizations/{slug}/accounts", acme)
                .then()
                .statusCode(401);
        assertThat(mailbox.getMailsSentTo(email)).isEmpty();
        // An address that has an account already.
        in(boss, acme)
                .body(account(ada, "Ada", List.of()))
                .post("/api/v1/organizations/{slug}/accounts", acme)
                .then()
                .statusCode(409);
        // Roles of the organization only.
        in(boss, acme)
                .body(account(email, "X", List.of("platform-admin")))
                .post("/api/v1/organizations/{slug}/accounts", acme)
                .then()
                .statusCode(400);
    }

    @Test
    void aGuestIsRefused() {
        // A person of Globex, admitted to a team of Acme as a guest (MK-032).
        String guest = register(globex);
        String team = in(boss, acme)
                .body(Map.of("name", "Roads", "description", "Roads", "visibility", "private"))
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
        in(boss, acme)
                .body(Map.of("role", "guest"))
                .put("/api/v1/teams/" + team + "/members/" + guest)
                .then()
                .statusCode(200);
        in(guest, acme)
                .body(account(unique("g") + "@example.org", "G", List.of()))
                .post("/api/v1/organizations/{slug}/accounts", acme)
                .then()
                .statusCode(403);
    }

    @Test
    void aPlatformAdministratorCreatesAccountsInAnyOrganization() {
        String email = unique("carla") + "@example.org";
        asAdmin()
                .body(account(email, "Carla", List.of("organization-admin", "organization-user")))
                .post("/api/v1/organizations/{slug}/accounts", globex)
                .then()
                .statusCode(201)
                .body("member.roles", containsInAnyOrder("organization-admin", "organization-user"));
        setPassword(tokenMailedTo(email), 204);
        as(email, PASSWORD)
                .header("X-Mosaikit-Organization", globex)
                .get("/api/v1/organizations/{slug}/members", globex)
                .then()
                .statusCode(200);
    }

    @Test
    void anAdministratorOfTheOrganizationIssuesLinksOnlyForPeopleOfTheirOrganizationAlone() {
        // A person created in Globex, then added to Acme too.
        String email = unique("dino") + "@example.org";
        asAdmin()
                .body(account(email, "Dino", List.of()))
                .post("/api/v1/organizations/{slug}/accounts", globex)
                .then()
                .statusCode(201);
        asAdmin()
                .body(Map.of("roles", List.of("organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", acme, email)
                .then()
                .statusCode(200);
        in(boss, acme)
                .post("/api/v1/organizations/{slug}/accounts/{email}/password-link", acme, email)
                .then()
                .statusCode(403);
        asAdmin()
                .post("/api/v1/organizations/{slug}/accounts/{email}/password-link", acme, email)
                .then()
                .statusCode(200);
        // Nobody who is not a member.
        in(boss, acme)
                .post("/api/v1/organizations/{slug}/accounts/{email}/password-link", acme, "nobody@example.org")
                .then()
                .statusCode(404);
    }

    @Test
    void creatingTheAccountAndIssuingAndUsingTheLinkAreAudited() {
        String email = unique("elio") + "@example.org";
        in(boss, acme)
                .body(account(email, "Elio", List.of()))
                .post("/api/v1/organizations/{slug}/accounts", acme)
                .then()
                .statusCode(201);
        String token = tokenMailedTo(email);
        setPassword(token, 204);

        String id = asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");
        List<Map<String, Object>> events = asAdmin()
                .get("/api/v1/audit-events?organization={id}&limit=500", id)
                .then()
                .statusCode(200)
                .extract()
                .path("findAll { it.subject == '" + acme + "/" + email + "' || it.subject == '" + email + "' }");
        assertThat(events)
                .extracting(event -> event.get("action"))
                .containsExactlyInAnyOrder(
                        "organization.account.created", "account.password-link.issued", "account.password-link.used");
        assertThat(events)
                .filteredOn(event -> "account.password-link.used".equals(event.get("action")))
                .extracting(event -> event.get("actor"))
                .containsExactly(email);
        assertThat(events)
                .filteredOn(event -> "organization.account.created".equals(event.get("action")))
                .extracting(event -> event.get("actor"))
                .containsExactly(boss);
        // Never the token.
        assertThat(events.toString()).doesNotContain(token);
    }
}
