// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.secrets.SecretRows;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.sql.Connection;
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
 * The {@code Secrets} bean of extensions (MK-062): an extension backend, through {@link SecretsProbe},
 * reads a credential by name on the server, in the organization of the request, and only the
 * credentials meant for it or for any extension; the browser never receives the value, and reads are
 * audited without it.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-062")
class SecretsTest {

    static final String PASSWORD = "a long enough password";
    static final String NOTIFY = "dev.mosaikit.test.notify";
    static final String TODO = "dev.mosaikit.test.todo";

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
        String slug = unique("vault");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("vault") + "@example.org";
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

    private static String value() {
        return "sk-vault-" + UUID.randomUUID().toString().replace("-", "");
    }

    private static void store(String admin, String organization, String name, String value, String extension) {
        Map<String, Object> body = new HashMap<>(Map.of("name", name, "kind", "token", "value", value));
        if (extension != null) {
            body.put("extension", extension);
        }
        in(admin, organization)
                .body(body)
                .post("/api/v1/organizations/" + organization + "/secrets")
                .then()
                .statusCode(201);
    }

    /** What the extension backend answers after using the credential. */
    private static Response use(String person, String organization, String extension, String name) {
        return in(person, organization).get("/api/v1/test/secrets/{extension}/{name}", extension, name);
    }

    private static String sha256(String value) throws NoSuchAlgorithmException {
        return HexFormat.of()
                .formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    private Connection owner() throws SQLException {
        Connection connection = dataSource.getConnection();
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

    private void write(String slug, String name, SecretRows.Row row) throws SQLException {
        try (var connection = owner();
                var statement = connection.prepareStatement("update mk_kernel.secret set key_id = ?, wrapped_key = ?,"
                        + " ciphertext = ? where organization_id = ? and name = ?")) {
            statement.setString(1, row.keyId());
            statement.setBytes(2, row.wrappedKey());
            statement.setBytes(3, row.ciphertext());
            statement.setObject(4, organizationId(slug));
            statement.setString(5, name);
            assertThat(statement.executeUpdate()).isEqualTo(1);
        }
    }

    private SecretRows.Row row(String slug, String name) throws SQLException {
        try (var connection = owner();
                var statement = connection.prepareStatement("select key_id, wrapped_key, ciphertext"
                        + " from mk_kernel.secret where organization_id = ? and name = ?")) {
            statement.setObject(1, organizationId(slug));
            statement.setString(2, name);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                return new SecretRows.Row(result.getString(1), result.getBytes(2), result.getBytes(3));
            }
        }
    }

    // Acceptance 2.

    @Test
    void anExtensionBackendReadsTheCredentialOfTheOrganizationOfTheRequest() throws NoSuchAlgorithmException {
        String acmeValue = value();
        String globexValue = value();
        store(boss, acme, "model-provider", acmeValue, null);
        store(globexBoss, globex, "model-provider", globexValue, null);

        // Any person of the organization: the extension uses the credential for them, they never see it.
        Response used = use(ada, acme, NOTIFY, "model-provider");
        used.then()
                .statusCode(200)
                .body("sha256", equalTo(sha256(acmeValue)))
                .body("masked", equalTo("SecretValue[••••]"));
        assertThat(used.asString()).doesNotContain(acmeValue);
        use(globexBoss, globex, NOTIFY, "model-provider")
                .then()
                .statusCode(200)
                .body("sha256", equalTo(sha256(globexValue)));

        // Without an organization the extension reads nothing.
        asAdmin()
                .get("/api/v1/test/secrets/{extension}/{name}", NOTIFY, "model-provider")
                .then()
                .statusCode(403);
        // Only an active extension.
        use(ada, acme, "dev.mosaikit.test.absent", "model-provider").then().statusCode(400);
    }

    @Test
    void aCredentialMeantForAnExtensionIsReadByItOnly() throws NoSuchAlgorithmException {
        String value = value();
        store(boss, acme, "reports-key", value, TODO);

        use(ada, acme, TODO, "reports-key").then().statusCode(200).body("sha256", equalTo(sha256(value)));
        use(ada, acme, NOTIFY, "reports-key")
                .then()
                .statusCode(404)
                .body("detail", equalTo("No credential named reports-key for " + NOTIFY + " in the organization."));
        use(ada, acme, TODO, "absent-key")
                .then()
                .statusCode(404)
                .body("detail", equalTo("No credential named absent-key for " + TODO + " in the organization."));
    }

    @Test
    void readsAreAuditedWithoutTheValue() {
        String value = value();
        store(boss, acme, "audited-read", value, null);
        use(ada, acme, NOTIFY, "audited-read").then().statusCode(200);

        Response events = in(boss, acme)
                .queryParam("action", "secrets.read")
                .get("/api/v1/organizations/" + acme + "/audit-events");
        events.then()
                .statusCode(200)
                .body("[0].subject", equalTo("secret/audited-read"))
                .body("[0].actor", equalTo(ada))
                .body("[0].channel", equalTo("EXTENSION"))
                .body("[0].outcome", equalTo("SUCCEEDED"));
        assertThat(events.asString()).contains(NOTIFY).doesNotContain(value);
    }

    @Test
    void aCredentialUnderTheFormerKeyIsStillRead() throws SQLException, NoSuchAlgorithmException {
        String value = value();
        store(boss, acme, "before-rotation", value, null);
        write(acme, "before-rotation", SecretRows.sealFormer(organizationId(acme), "before-rotation", value));

        use(ada, acme, NOTIFY, "before-rotation").then().statusCode(200).body("sha256", equalTo(sha256(value)));
    }

    @Test
    void aRowSwappedFromAnotherOrganizationDoesNotDecrypt() throws SQLException {
        String acmeValue = value();
        store(boss, acme, "swapped", acmeValue, null);
        store(globexBoss, globex, "swapped", value(), null);
        write(globex, "swapped", row(acme, "swapped"));

        Response refused = use(globexBoss, globex, NOTIFY, "swapped");
        refused.then()
                .statusCode(503)
                .body(
                        "detail",
                        equalTo("The credential swapped cannot be decrypted with the master keys of the"
                                + " installation."));
        assertThat(refused.asString()).doesNotContain(acmeValue);
        in(globexBoss, globex)
                .queryParam("action", "secrets.read")
                .get("/api/v1/organizations/" + globex + "/audit-events")
                .then()
                .body("[0].outcome", equalTo("FAILED"));
    }

    @Test
    void theBrowserNeverReceivesAValue() throws IOException {
        // No answer of the kernel API carries a value: the views of credentials have no such field.
        JsonNode openApi = new ObjectMapper()
                .readTree(given().queryParam("format", "json").get("/q/openapi").asString());
        JsonNode schemas = openApi.path("components").path("schemas");
        assertThat(schemas.has("SecretView")).isTrue();
        assertThat(schemas.path("SecretView").path("properties").has("value")).isFalse();
        assertThat(schemas.path("SecretView").path("properties").has("hint")).isTrue();
    }

    // Acceptance 3, for reads.

    @Test
    void valuesNeverAppearInLogsWhenExtensionsReadThem() throws SQLException {
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
        String value = value();
        String other = value();
        store(boss, acme, "logged-read", value, null);
        store(globexBoss, globex, "logged-read", other, null);
        Logger root = Logger.getLogger("");
        Logger kernel = Logger.getLogger("dev.mosaikit");
        Level kernelLevel = kernel.getLevel();
        root.addHandler(capture);
        kernel.setLevel(Level.ALL);
        List<String> answers = new ArrayList<>();
        try {
            answers.add(use(ada, acme, NOTIFY, "logged-read")
                    .then()
                    .statusCode(200)
                    .extract()
                    .asString());
            answers.add(use(ada, acme, TODO, "logged-missing")
                    .then()
                    .statusCode(404)
                    .extract()
                    .asString());
            write(globex, "logged-read", row(acme, "logged-read"));
            answers.add(use(globexBoss, globex, NOTIFY, "logged-read")
                    .then()
                    .statusCode(503)
                    .extract()
                    .asString());
        } finally {
            root.removeHandler(capture);
            kernel.setLevel(kernelLevel);
        }

        synchronized (logged) {
            assertThat(logged).anyMatch(line -> line.contains("logged-read"));
            assertThat(logged).noneMatch(line -> line.contains(value) || line.contains(other));
        }
        assertThat(answers).noneMatch(answer -> answer.contains(value) || answer.contains(other));
    }
}
