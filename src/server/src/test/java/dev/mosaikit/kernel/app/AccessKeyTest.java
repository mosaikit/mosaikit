// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;

import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Personal access keys (MK-060): created by a person, who sees the secret once; refused at the next
 * request once revoked, while the sessions go on; read-only without the write switch, on the APIs of
 * the kernel and of extensions; checked by services through the kernel; disabled by a suspension and
 * by the removal from the organization; kept away from the shell, sessions and keys; audited.
 */
@QuarkusTest
@Tag("MK-060")
class AccessKeyTest {

    private static final String KEYS = "/api/v1/accounts/me/access-keys";
    private static final String SESSION = "mosaikit-session";
    private static final String PASSWORD = "a long enough password";

    @Inject
    AgroalDataSource dataSource;

    private String organization;
    private String person;

    @BeforeEach
    void registerAPerson() {
        organization = TestData.unique("keys");
        person = TestData.unique("kim") + "@example.org";
        asAdmin()
                .body(Map.of("slug", organization, "name", "Acme keys", "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        anonymous()
                .body(Map.of("organization", organization, "email", person, "displayName", "Kim", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
    }

    private RequestSpecification asPerson() {
        return as(person, PASSWORD);
    }

    private static RequestSpecification withKey(String key) {
        return given().header("Authorization", "Bearer " + key).contentType(ContentType.JSON);
    }

    private Map<String, Object> create(String name, boolean write) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", name);
        body.put("organization", organization);
        body.put("write", write);
        return asPerson().body(body).post(KEYS).then().statusCode(201).extract().path("$");
    }

    private static String secret(Map<String, Object> created) {
        return (String) created.get("secret");
    }

    @Test
    void showsTheSecretOnceAndListsTheKeysWithoutIt() throws SQLException {
        Map<String, Object> created = create("Nightly export", false);
        String key = secret(created);
        assertThat(key).startsWith("mk_");
        assertThat(created)
                .containsEntry("name", "Nightly export")
                .containsEntry("prefix", key.substring(0, 11))
                .containsEntry("organization", organization)
                .containsEntry("write", false)
                .containsEntry("expired", false);
        Instant expires = Instant.parse((String) created.get("expiresAt"));
        assertThat(expires)
                .isBetween(
                        Instant.now().plus(Duration.ofDays(364)), Instant.now().plus(Duration.ofDays(366)));

        asPerson()
                .get(KEYS)
                .then()
                .statusCode(200)
                .body("maxValidityDays", equalTo(365))
                .body("keys", hasSize(1))
                .body("keys[0].prefix", equalTo(key.substring(0, 11)))
                .body("keys[0].createdAt", notNullValue())
                .body("keys[0].expiresAt", notNullValue())
                .body("keys[0].lastUsedAt", nullValue())
                .body("keys[0]", not(hasKey("secret")));

        // The key acts for its person, and its use shows in the list.
        withKey(key).get("/api/v1/accounts/me").then().statusCode(200).body("username", equalTo(person));
        asPerson().get(KEYS).then().body("keys[0].lastUsedAt", notNullValue());

        // Only a digest is kept.
        try (var connection = dataSource.getConnection();
                var statement = connection.prepareStatement(
                        "select count(*) from mk_kernel.access_key where token_digest = ? or prefix = ?")) {
            statement.setString(1, key);
            statement.setString(2, key);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getInt(1)).isZero();
            }
        }

        // Every use is audited, without the secret.
        String events = asAdmin().get("/api/v1/audit-events?limit=50").asString();
        assertThat(events)
                .contains("account.access-key.created", "account.access-key.used")
                .doesNotContain(key);
    }

    @Test
    void refusesAnExpiryPastTheMaximumAndAnOrganizationOfOthers() {
        asPerson()
                .body(Map.of(
                        "name",
                        "Too long",
                        "organization",
                        organization,
                        "expiresAt",
                        Instant.now().plus(Duration.ofDays(400)).toString()))
                .post(KEYS)
                .then()
                .statusCode(400);
        asPerson()
                .body(Map.of("name", "", "organization", organization))
                .post(KEYS)
                .then()
                .statusCode(400);
        String other = TestData.unique("other-keys");
        asAdmin()
                .body(Map.of("slug", other, "name", "Green keys"))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        asPerson()
                .body(Map.of("name", "Elsewhere", "organization", other))
                .post(KEYS)
                .then()
                .statusCode(400);
        Map<String, Object> monthly = asPerson()
                .body(Map.of(
                        "name",
                        "Monthly",
                        "organization",
                        organization,
                        "expiresAt",
                        Instant.now().plus(Duration.ofDays(30)).toString()))
                .post(KEYS)
                .then()
                .statusCode(201)
                .extract()
                .path("$");
        assertThat(Instant.parse((String) monthly.get("expiresAt")))
                .isBefore(Instant.now().plus(Duration.ofDays(31)));
    }

    @Test
    void refusesARevokedKeyAtTheNextRequestWhileTheSessionsGoOn() {
        String cookie = given().formParam("username", person)
                .formParam("password", PASSWORD)
                .post("/api/v1/accounts/session")
                .then()
                .statusCode(200)
                .extract()
                .cookie(SESSION);
        Map<String, Object> created = create("Laptop script", false);
        String key = secret(created);
        withKey(key).get("/api/v1/accounts/me").then().statusCode(200);

        given().cookie(SESSION, cookie)
                .delete(KEYS + "/{id}", created.get("id"))
                .then()
                .statusCode(204);

        // Right after the revocation, with no wait.
        withKey(key).get("/api/v1/accounts/me").then().statusCode(401);
        withKey(key).get("/api/v1/access-keys/current").then().statusCode(401);
        given().cookie(SESSION, cookie).get("/api/v1/accounts/me").then().statusCode(200);
        asPerson().get(KEYS).then().body("keys", hasSize(0));
        given().cookie(SESSION, cookie)
                .delete(KEYS + "/{id}", created.get("id"))
                .then()
                .statusCode(404);
        asAdmin()
                .get("/api/v1/audit-events?limit=50")
                .then()
                .body("action", hasItem("account.access-key.revoked"))
                .body("action", hasItem("account.access-key.refused"));
    }

    @Test
    void aKeyWithoutTheWriteSwitchOnlyReads() {
        String reader = secret(create("Reader", false));
        Map<String, Object> preferences = withKey(reader)
                .get("/api/v1/accounts/me/preferences")
                .then()
                .statusCode(200)
                .extract()
                .path("$");

        // Kernel APIs.
        withKey(reader)
                .body(preferences)
                .put("/api/v1/accounts/me/preferences")
                .then()
                .statusCode(403)
                .body("detail", equalTo("This access key was created without the write switch: it only reads."));
        withKey(reader).post("/api/v1/teams").then().statusCode(403);
        withKey(reader).post("/api/v1/notifications/read").then().statusCode(403);
        // Extension APIs, refused before the extension is even looked for.
        withKey(reader).body("{}").post("/api/v1/ext/anything/items").then().statusCode(403);
        withKey(reader).get("/api/v1/ext/anything/items").then().statusCode(404);

        String writer = secret(create("Writer", true));
        withKey(writer)
                .body(preferences)
                .put("/api/v1/accounts/me/preferences")
                .then()
                .statusCode(200);
        asAdmin()
                .get("/api/v1/audit-events?limit=50")
                .then()
                .body("find { it.action == 'account.access-key.refused' }.detail", containsString("read-only"))
                .body("find { it.action == 'account.access-key.refused' }.channel", equalTo("API_KEY"));
    }

    @Test
    void aKeyNeverManagesKeysOrSessions() {
        String writer = secret(create("Writer", true));
        withKey(writer).get(KEYS).then().statusCode(403);
        withKey(writer)
                .body(Map.of("name", "Another", "write", true))
                .post(KEYS)
                .then()
                .statusCode(403);
        withKey(writer).get("/api/v1/accounts/me/sessions").then().statusCode(403);
        withKey(writer).post("/api/v1/accounts/session/remembrance").then().statusCode(403);
    }

    @Test
    void aServiceLearnsWhomAKeyActsFor() {
        String key = secret(create("Gateway", false));

        withKey(key)
                .get("/api/v1/access-keys/current")
                .then()
                .statusCode(200)
                .body("name", equalTo("Gateway"))
                .body("prefix", equalTo(key.substring(0, 11)))
                .body("write", equalTo(false))
                .body("expiresAt", notNullValue())
                .body("account.username", equalTo(person))
                .body("account.displayName", equalTo("Kim"))
                .body("organization.slug", equalTo(organization))
                .body("organization.id", notNullValue())
                .body("roles", hasItem("organization-user"));

        // A request without a key has nothing to validate; a key never issued is refused.
        asPerson().get("/api/v1/access-keys/current").then().statusCode(404);
        withKey("mk_" + "x".repeat(43))
                .get("/api/v1/access-keys/current")
                .then()
                .statusCode(401);
        anonymous().get("/api/v1/access-keys/current").then().statusCode(401);
    }

    @Test
    void aSuspensionAndTheRemovalFromTheOrganizationDisableTheKeys() {
        String first = secret(create("First", true));
        withKey(first).get("/api/v1/accounts/me").then().statusCode(200);

        asAdmin()
                .delete("/api/v1/organizations/{slug}/members/{email}", organization, person)
                .then()
                .statusCode(204);
        withKey(first).get("/api/v1/accounts/me").then().statusCode(401);

        // Back in the organization, a new key; then a suspension.
        asAdmin()
                .body(Map.of("roles", List.of("organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", organization, person)
                .then()
                .statusCode(200);
        withKey(first).get("/api/v1/accounts/me").then().statusCode(401);
        String second = secret(create("Second", true));
        withKey(second).get("/api/v1/accounts/me").then().statusCode(200);

        asAdmin()
                .put("/api/v1/platform/accounts/{email}/suspension", person)
                .then()
                .statusCode(200);
        withKey(second).get("/api/v1/accounts/me").then().statusCode(401);
        asAdmin()
                .delete("/api/v1/platform/accounts/{email}/suspension", person)
                .then()
                .statusCode(200);
        // The keys stay revoked after the reactivation, as the sessions stay ended.
        withKey(second).get("/api/v1/accounts/me").then().statusCode(401);
    }

    @Test
    void aKeyCarriesNoRoleOfThePlatform() {
        String key = secret(create("Plain", true));
        withKey(key).get("/api/v1/platform/settings").then().statusCode(403);
    }
}
