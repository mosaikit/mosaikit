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
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;

import dev.mosaikit.kernel.core.secrets.SecretRows;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Handler;
import java.util.logging.Level;
import java.util.logging.LogRecord;
import java.util.logging.Logger;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The store of credentials of organizations (MK-062): their administrators store, replace and delete
 * credentials that are encrypted at rest and never come back in clear, in answers, the audit log,
 * error messages or logs; platform administrators move them to a new master key.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-062")
class SecretStoreTest {

    static final String PASSWORD = "a long enough password";

    @Inject
    AgroalDataSource dataSource;

    private String acme;
    private String globex;
    private String boss;
    private String ada;
    private String globexBoss;

    @BeforeEach
    void people() {
        acme = organization();
        globex = organization();
        boss = register(acme);
        ada = register(acme);
        globexBoss = register(globex);
        administrator(boss, acme);
        administrator(globexBoss, globex);
    }

    // Helpers.

    private static String organization() {
        String slug = unique("secrets");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("secrets") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static void administrator(String email, String organization) {
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", organization, email)
                .then()
                .statusCode(200);
    }

    private static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    private static String secrets(String organization) {
        return "/api/v1/organizations/" + organization + "/secrets";
    }

    /** A value that no other test uses, to look for it everywhere. */
    private static String value() {
        return "sk-test-" + UUID.randomUUID().toString().replace("-", "");
    }

    private static Map<String, Object> credential(String name, String kind, String value) {
        Map<String, Object> body = new HashMap<>(Map.of("name", name, "kind", kind));
        if (value != null) {
            body.put("value", value);
        }
        return body;
    }

    private Response store(String organization, String name, String kind, String value) {
        return in(boss, organization).body(credential(name, kind, value)).post(secrets(organization));
    }

    /**
     * A connection as the owner of the tables: the tests run in a request context, whose connections
     * row-level security limits to the organization of the request, here none.
     */
    private java.sql.Connection owner() throws SQLException {
        java.sql.Connection connection = dataSource.getConnection();
        try (var statement = connection.createStatement()) {
            statement.execute("select set_config('role', 'none', false)");
        }
        return connection;
    }

    private UUID organizationId(String slug) throws SQLException {
        try (var connection = owner();
                var statement = connection.prepareStatement("select id from mk_kernel.organization where slug = ?")) {
            statement.setString(1, slug);
            try (var result = statement.executeQuery()) {
                result.next();
                return result.getObject(1, UUID.class);
            }
        }
    }

    /** The stored row of a credential, read as the owner of the tables. */
    private SecretRows.Row row(String slug, String name) throws SQLException {
        try (var connection = owner();
                var statement = connection.prepareStatement("select key_id, wrapped_key, ciphertext"
                        + " from mk_kernel.secret where organization_id = ? and name = ?")) {
            statement.setObject(1, organizationId(slug));
            statement.setString(2, name);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).as("the row of " + name).isTrue();
                return new SecretRows.Row(result.getString(1), result.getBytes(2), result.getBytes(3));
            }
        }
    }

    /** Every column of the row of a credential, as text, the bytes in hex and as characters. */
    private String rowText(String slug, String name) throws SQLException {
        try (var connection = owner();
                var statement =
                        connection.prepareStatement("select s::text, ciphertext, wrapped_key from mk_kernel.secret s"
                                + " where organization_id = ? and name = ?")) {
            statement.setObject(1, organizationId(slug));
            statement.setString(2, name);
            try (var result = statement.executeQuery()) {
                result.next();
                return result.getString(1)
                        + new String(result.getBytes(2), StandardCharsets.ISO_8859_1)
                        + new String(result.getBytes(3), StandardCharsets.ISO_8859_1);
            }
        }
    }

    private static String hex(String value) {
        return HexFormat.of().formatHex(value.getBytes(StandardCharsets.UTF_8));
    }

    // Acceptance 1: stored encrypted, never returned in clear; replace and delete.

    @Test
    void anAdministratorStoresACredentialThatIsEncryptedAndNeverReturned() throws SQLException {
        String value = value();
        Map<String, Object> body = credential("model-provider", "token", value);
        body.put("description", "The key of the model provider");
        body.put("extension", "org.example.reports");

        Response created = in(boss, acme).body(body).post(secrets(acme));
        created.then()
                .statusCode(201)
                .header("Location", org.hamcrest.Matchers.endsWith("/secrets/model-provider"))
                .body("name", equalTo("model-provider"))
                .body("kind", equalTo("token"))
                .body("description", equalTo("The key of the model provider"))
                .body("extension", equalTo("org.example.reports"))
                .body("hint", equalTo("••••" + value.substring(value.length() - 4)))
                .body("updatedBy", equalTo(boss))
                .body("value", nullValue());
        assertThat(created.asString()).doesNotContain(value);

        Response list = in(boss, acme).get(secrets(acme));
        list.then().statusCode(200).body("name", hasItem("model-provider"));
        assertThat(list.asString()).doesNotContain(value);
        Response one = in(boss, acme).get(secrets(acme) + "/model-provider");
        one.then().statusCode(200).body("kind", equalTo("token"));
        assertThat(one.asString()).doesNotContain(value);

        // At rest: under the current master key, neither the value nor its bytes in the row.
        SecretRows.Row row = row(acme, "model-provider");
        assertThat(row.keyId()).isEqualTo(SecretRows.currentId());
        assertThat(rowText(acme, "model-provider")).doesNotContain(value).doesNotContain(hex(value));
        assertThat(SecretRows.open(organizationId(acme), "model-provider", row)).isEqualTo(value);

        // A password shows nothing of its value.
        store(acme, "database", "password", value()).then().statusCode(201).body("hint", equalTo("••••"));
    }

    @Test
    void anAdministratorReplacesAndDeletesACredential() throws SQLException {
        String first = value();
        String second = value();
        store(acme, "mail", "password", first).then().statusCode(201);
        SecretRows.Row before = row(acme, "mail");

        Response replaced = in(boss, acme)
                .body(Map.of("kind", "token", "value", second, "description", "Rotated"))
                .put(secrets(acme) + "/mail");
        replaced.then().statusCode(200).body("kind", equalTo("token")).body("description", equalTo("Rotated"));
        assertThat(replaced.asString()).doesNotContain(second).doesNotContain(first);
        SecretRows.Row after = row(acme, "mail");
        assertThat(after.ciphertext()).isNotEqualTo(before.ciphertext());
        assertThat(SecretRows.open(organizationId(acme), "mail", after)).isEqualTo(second);

        // Without a value, the value stays as it is.
        in(boss, acme)
                .body(Map.of("kind", "token", "description", "Only the description"))
                .put(secrets(acme) + "/mail")
                .then()
                .statusCode(200)
                .body("description", equalTo("Only the description"));
        assertThat(row(acme, "mail").ciphertext()).isEqualTo(after.ciphertext());

        // The name does not change.
        in(boss, acme)
                .body(Map.of("name", "other", "kind", "token"))
                .put(secrets(acme) + "/mail")
                .then()
                .statusCode(400);

        // A name is stored once.
        store(acme, "mail", "token", value()).then().statusCode(409);

        in(boss, acme).delete(secrets(acme) + "/mail").then().statusCode(204);
        in(boss, acme).get(secrets(acme) + "/mail").then().statusCode(404);
        in(boss, acme).delete(secrets(acme) + "/mail").then().statusCode(404);
    }

    @Test
    void onlyTheAdministratorsOfTheOrganizationSignedInToItKeepItsCredentials() {
        store(acme, "shared-service", "key", value()).then().statusCode(201);

        anonymous().get(secrets(acme)).then().statusCode(401);
        in(ada, acme).get(secrets(acme)).then().statusCode(403);
        in(ada, acme)
                .body(credential("mine", "token", value()))
                .post(secrets(acme))
                .then()
                .statusCode(403);
        in(globexBoss, globex).get(secrets(acme)).then().statusCode(403);
        // Platform administrators are not administrators of the organization.
        asAdmin().get(secrets(acme)).then().statusCode(403);

        // Each organization sees only its own.
        in(globexBoss, globex).get(secrets(globex)).then().statusCode(200).body("name", not(hasItem("shared-service")));
    }

    @Test
    void refusesInvalidCredentials() {
        String value = value();
        Response wrongKind = store(acme, "valid-name", "certificate", value);
        wrongKind.then().statusCode(400);
        assertThat(wrongKind.asString()).contains("kind must be one of").doesNotContain(value);
        store(acme, "Not A Name", "token", value).then().statusCode(400);
        store(acme, "no-value", "token", null).then().statusCode(400);
        store(acme, "empty", "token", "").then().statusCode(400);
        Map<String, Object> body = credential("bad-extension", "token", value);
        body.put("extension", "not an extension");
        in(boss, acme).body(body).post(secrets(acme)).then().statusCode(400);
    }

    @Test
    void everyChangeIsAuditedWithoutTheValue() {
        String value = value();
        store(acme, "audited", "token", value).then().statusCode(201);
        in(boss, acme)
                .body(Map.of("kind", "token", "value", value()))
                .put(secrets(acme) + "/audited")
                .then()
                .statusCode(200);
        in(boss, acme).delete(secrets(acme) + "/audited").then().statusCode(204);

        Response events =
                in(boss, acme).queryParam("action", "secrets.").get("/api/v1/organizations/" + acme + "/audit-events");
        events.then().statusCode(200);
        assertThat(events.jsonPath().getList("action", String.class))
                .contains("secrets.stored", "secrets.replaced", "secrets.deleted");
        assertThat(events.jsonPath().getList("subject", String.class)).contains("secret/audited");
        assertThat(events.asString()).doesNotContain(value);
    }

    // Acceptance 3: never in logs nor error messages.

    @Test
    void valuesNeverAppearInLogsNorInErrorMessages() {
        List<String> logged = new ArrayList<>();
        Handler capture = new Handler() {
            @Override
            public void publish(LogRecord record) {
                StringBuilder text = new StringBuilder(String.valueOf(record.getMessage()));
                if (record.getParameters() != null) {
                    for (Object parameter : record.getParameters()) {
                        text.append(' ').append(parameter);
                    }
                }
                for (Throwable thrown = record.getThrown(); thrown != null; thrown = thrown.getCause()) {
                    text.append(' ').append(thrown);
                }
                synchronized (logged) {
                    logged.add(text.toString());
                }
            }

            @Override
            public void flush() {}

            @Override
            public void close() {}
        };
        capture.setLevel(Level.ALL);
        Logger root = Logger.getLogger("");
        Logger kernel = Logger.getLogger("dev.mosaikit");
        Level kernelLevel = kernel.getLevel();
        root.addHandler(capture);
        kernel.setLevel(Level.ALL);
        List<String> answers = new ArrayList<>();
        String value = value();
        String other = value();
        try {
            answers.add(store(acme, "logged", "token", value)
                    .then()
                    .statusCode(201)
                    .extract()
                    .asString());
            answers.add(in(boss, acme)
                    .body(Map.of("kind", "key", "value", other))
                    .put(secrets(acme) + "/logged")
                    .then()
                    .statusCode(200)
                    .extract()
                    .asString());
            // Failures, each with a value in the request.
            answers.add(store(acme, "logged", "token", value)
                    .then()
                    .statusCode(409)
                    .extract()
                    .asString());
            answers.add(store(acme, "logged-kind", "nope", value)
                    .then()
                    .statusCode(400)
                    .extract()
                    .asString());
            Response missing =
                    in(boss, acme).body(Map.of("kind", "token", "value", value)).put(secrets(acme) + "/absent-name");
            missing.then()
                    .statusCode(404)
                    .body("detail", equalTo("No credential named absent-name in the organization."));
            answers.add(missing.asString());
            answers.add(in(ada, acme)
                    .body(credential("x", "token", value))
                    .post(secrets(acme))
                    .asString());
            // A body that is not JSON, with the value in it.
            answers.add(in(boss, acme)
                    .body("{\"name\": \"broken\", \"kind\": \"token\", \"value\": \"" + value + "\"")
                    .post(secrets(acme))
                    .then()
                    .statusCode(400)
                    .extract()
                    .asString());
            answers.add(in(boss, acme).get(secrets(acme)).asString());
            answers.add(in(boss, acme)
                    .get("/api/v1/organizations/" + acme + "/audit-events")
                    .asString());
        } finally {
            root.removeHandler(capture);
            kernel.setLevel(kernelLevel);
        }

        assertThat(logged).as("what the kernel logged").isNotEmpty();
        synchronized (logged) {
            assertThat(logged).noneMatch(line -> line.contains(value) || line.contains(other));
        }
        assertThat(answers).noneMatch(answer -> answer.contains(value) || answer.contains(other));
    }

    // The rotation of the master key.

    @Test
    void aPlatformAdministratorMovesTheCredentialsToTheCurrentKey() throws SQLException {
        String value = value();
        store(acme, "rotated", "token", value).then().statusCode(201);
        UUID organization = organizationId(acme);
        // The row as a kernel would have written it before the rotation, under the former key.
        SecretRows.Row old = SecretRows.sealFormer(organization, "rotated", value);
        try (var connection = owner();
                var statement = connection.prepareStatement("update mk_kernel.secret set key_id = ?, wrapped_key = ?,"
                        + " ciphertext = ? where organization_id = ? and name = ?")) {
            statement.setString(1, old.keyId());
            statement.setBytes(2, old.wrappedKey());
            statement.setBytes(3, old.ciphertext());
            statement.setObject(4, organization);
            statement.setString(5, "rotated");
            assertThat(statement.executeUpdate()).isEqualTo(1);
        }

        Response keys = asAdmin().get("/api/v1/platform/secrets/keys");
        keys.then()
                .statusCode(200)
                .body("enabled", equalTo(true))
                .body("currentKey", equalTo(SecretRows.currentId()))
                .body("previousKeys", hasItem(SecretRows.formerId()));
        assertThat(keys.jsonPath().getMap("credentials", String.class, Integer.class))
                .hasEntrySatisfying(
                        SecretRows.formerId(), count -> assertThat(count).isPositive());
        in(boss, acme).post("/api/v1/platform/secrets/re-encryption").then().statusCode(403);

        Response moved = asAdmin().post("/api/v1/platform/secrets/re-encryption");
        moved.then()
                .statusCode(200)
                .body("currentKey", equalTo(SecretRows.currentId()))
                .body("unreadable", equalTo(0));
        assertThat(moved.jsonPath().getInt("reEncrypted")).isGreaterThanOrEqualTo(1);

        SecretRows.Row now = row(acme, "rotated");
        assertThat(now.keyId()).isEqualTo(SecretRows.currentId());
        assertThat(now.ciphertext()).isEqualTo(old.ciphertext());
        assertThat(SecretRows.open(organization, "rotated", now)).isEqualTo(value);
        assertThat(asAdmin()
                        .get("/api/v1/platform/secrets/keys")
                        .jsonPath()
                        .getMap("credentials", String.class, Integer.class))
                .doesNotContainKey(SecretRows.formerId());
    }
}
