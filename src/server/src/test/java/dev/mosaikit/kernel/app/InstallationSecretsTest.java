// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.api.context.NoOrganizationException;
import dev.mosaikit.kernel.api.secrets.SecretValue;
import dev.mosaikit.kernel.api.secrets.Secrets;
import dev.mosaikit.kernel.core.data.RowSecurity;
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
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The credentials of the installation (MK-127): platform administrators keep them encrypted like
 * those of organizations, extension backends read them by name on the server, also outside any
 * organization, and the credential of the organization wins when both hold the same name.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-127")
class InstallationSecretsTest {

    static final String PASSWORD = "a long enough password";
    static final String NOTIFY = "dev.mosaikit.test.notify";
    static final String TODO = "dev.mosaikit.test.todo";
    static final String CREDENTIALS = "/api/v1/platform/credentials";

    @Inject
    AgroalDataSource dataSource;

    @Inject
    Secrets secrets;

    @Inject
    RowSecurity rowSecurity;

    private String acme;
    private String globex;
    private String boss;
    private String ada;

    @BeforeEach
    void people() {
        acme = organization();
        globex = organization();
        boss = register(acme);
        ada = register(acme);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", acme, boss)
                .then()
                .statusCode(200);
    }

    // Helpers.

    private static String organization() {
        String slug = unique("shared");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("shared") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    private static String value() {
        return "sk-shared-" + UUID.randomUUID().toString().replace("-", "");
    }

    private static String name() {
        return unique("cred").toLowerCase(java.util.Locale.ROOT);
    }

    private static Map<String, Object> body(String name, String value, String extension) {
        Map<String, Object> body = new HashMap<>(Map.of("name", name, "kind", "token", "value", value));
        if (extension != null) {
            body.put("extension", extension);
        }
        return body;
    }

    private static Response storeOfInstallation(String name, String value, String extension) {
        return asAdmin().body(body(name, value, extension)).post(CREDENTIALS);
    }

    private void storeOfOrganization(String name, String value, String extension) {
        in(boss, acme)
                .body(body(name, value, extension))
                .post("/api/v1/organizations/" + acme + "/secrets")
                .then()
                .statusCode(201);
    }

    private static Response resolved(RequestSpecification who, String extension, String name) {
        return who.get("/api/v1/test/secrets/resolved/{extension}/{name}", extension, name);
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

    private SecretRows.Row installationRow(String name) throws SQLException {
        try (var connection = owner();
                var statement = connection.prepareStatement("select key_id, wrapped_key, ciphertext"
                        + " from mk_kernel.installation_secret where name = ?")) {
            statement.setString(1, name);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                return new SecretRows.Row(result.getString(1), result.getBytes(2), result.getBytes(3));
            }
        }
    }

    private void writeInstallationRow(String name, SecretRows.Row row) throws SQLException {
        try (var connection = owner();
                var statement = connection.prepareStatement("update mk_kernel.installation_secret set key_id = ?,"
                        + " wrapped_key = ?, ciphertext = ? where name = ?")) {
            statement.setString(1, row.keyId());
            statement.setBytes(2, row.wrappedKey());
            statement.setBytes(3, row.ciphertext());
            statement.setString(4, name);
            assertThat(statement.executeUpdate()).isEqualTo(1);
        }
    }

    private SecretRows.Row organizationRow(String slug, String name) throws SQLException {
        try (var connection = owner();
                var statement = connection.prepareStatement("select s.key_id, s.wrapped_key, s.ciphertext"
                        + " from mk_kernel.secret s join mk_kernel.organization o on o.id = s.organization_id"
                        + " where o.slug = ? and s.name = ?")) {
            statement.setString(1, slug);
            statement.setString(2, name);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                return new SecretRows.Row(result.getString(1), result.getBytes(2), result.getBytes(3));
            }
        }
    }

    /** Reads through the bean on a thread of its own, where no request is active, as a scheduled job. */
    private Optional<String> resolveOutsideRequests(String extension, String name)
            throws InterruptedException, ExecutionException, TimeoutException {
        var executor = Executors.newSingleThreadExecutor();
        try {
            return CompletableFuture.supplyAsync(
                            () -> {
                                Optional<SecretValue> found = secrets.resolve(extension, name);
                                try (SecretValue value = found.orElse(null)) {
                                    return Optional.ofNullable(value)
                                            .map(v -> new String(v.bytes(), StandardCharsets.UTF_8));
                                }
                            },
                            executor)
                    .get(30, TimeUnit.SECONDS);
        } finally {
            executor.shutdownNow();
        }
    }

    // Acceptance 1.

    @Test
    void aPlatformAdministratorStoresACredentialOfTheInstallationEncryptedAndNeverReadsItBack()
            throws SQLException, IOException {
        String name = name();
        String value = value();
        Response stored = storeOfInstallation(name, value, null);
        stored.then()
                .statusCode(201)
                .body("name", equalTo(name))
                .body("kind", equalTo("token"))
                .body("hint", equalTo("••••" + value.substring(value.length() - 4)));
        assertThat(stored.asString()).doesNotContain(value);
        assertThat(asAdmin().get(CREDENTIALS).asString()).contains(name).doesNotContain(value);
        assertThat(asAdmin().get(CREDENTIALS + "/" + name).asString()).doesNotContain(value);
        asAdmin().body(body(name, value(), null)).post(CREDENTIALS).then().statusCode(409);

        // Encrypted at rest, bound to the scope of the installation.
        SecretRows.Row row = installationRow(name);
        assertThat(new String(row.ciphertext(), StandardCharsets.ISO_8859_1)).doesNotContain(value);
        assertThat(row.keyId()).isEqualTo(SecretRows.currentId());
        assertThat(SecretRows.openOfInstallation(name, row)).isEqualTo(value);

        // Replaced without a value, the value stays; with one, it changes; then deleted.
        asAdmin()
                .body(Map.of("kind", "key", "description", "The shared map server"))
                .put(CREDENTIALS + "/" + name)
                .then()
                .statusCode(200)
                .body("kind", equalTo("key"));
        assertThat(SecretRows.openOfInstallation(name, installationRow(name))).isEqualTo(value);
        String other = value();
        asAdmin()
                .body(Map.of("kind", "key", "value", other))
                .put(CREDENTIALS + "/" + name)
                .then()
                .statusCode(200);
        assertThat(SecretRows.openOfInstallation(name, installationRow(name))).isEqualTo(other);

        // Only platform administrators.
        in(boss, acme).get(CREDENTIALS).then().statusCode(403);
        in(boss, acme)
                .body(body(name(), value(), null))
                .post(CREDENTIALS)
                .then()
                .statusCode(403);
        anonymous().get(CREDENTIALS).then().statusCode(401);

        // Every change is in the log of the platform, without the value.
        Response events = asAdmin()
                .queryParam("platform", true)
                .queryParam("subject", "secret/" + name)
                .get("/api/v1/audit-events");
        events.then()
                .statusCode(200)
                .body("action", hasItem("secrets.stored"))
                .body("action", hasItem("secrets.replaced"));
        assertThat(events.asString())
                .doesNotContain(value)
                .doesNotContain(other)
                .contains("installation");

        asAdmin().delete(CREDENTIALS + "/" + name).then().statusCode(204);
        asAdmin().get(CREDENTIALS + "/" + name).then().statusCode(404);

        // The views never carry a value.
        JsonNode schemas = new ObjectMapper()
                .readTree(given().queryParam("format", "json").get("/q/openapi").asString())
                .path("components")
                .path("schemas");
        assertThat(schemas.path("SecretView").path("properties").has("value")).isFalse();
    }

    @Test
    void theMemberRoleOfRequestsCannotReachTheCredentialsOfTheInstallation() throws SQLException {
        storeOfInstallation(name(), value(), null).then().statusCode(201);
        String role = rowSecurity.role().orElseThrow();
        try (var connection = owner();
                var asMember = connection.prepareStatement("select set_config('role', ?, false)");
                var statement = connection.createStatement()) {
            asMember.setString(1, role);
            asMember.execute();
            assertThatThrownBy(() -> statement.executeQuery("select count(*) from mk_kernel.installation_secret"))
                    .isInstanceOf(SQLException.class)
                    .hasMessageContaining("permission denied");
        }
    }

    // Acceptance 2.

    @Test
    void anExtensionBackendReadsACredentialOfTheInstallationAlsoOutsideAnyOrganization() throws Exception {
        String name = name();
        String value = value();
        storeOfInstallation(name, value, null).then().statusCode(201);

        // In any organization, for any person: the browser receives what the backend answers only.
        Response used = resolved(in(ada, acme), NOTIFY, name);
        used.then().statusCode(200).body("sha256", equalTo(sha256(value))).body("masked", equalTo("SecretValue[••••]"));
        assertThat(used.asString()).doesNotContain(value);

        // A request without an organization.
        resolved(asAdmin(), NOTIFY, name).then().statusCode(200).body("sha256", equalTo(sha256(value)));

        // No request at all, as a scheduled job.
        assertThat(resolveOutsideRequests(NOTIFY, name)).contains(value);
        assertThat(resolveOutsideRequests(NOTIFY, "absent-" + name)).isEmpty();

        // find() keeps to the organization of the request, as before.
        in(ada, acme)
                .get("/api/v1/test/secrets/{extension}/{name}", NOTIFY, name)
                .then()
                .statusCode(404);
        assertThatThrownBy(() -> secrets.find(NOTIFY, name)).isInstanceOf(NoOrganizationException.class);

        // Only an active extension.
        resolved(in(ada, acme), "dev.mosaikit.test.absent", name).then().statusCode(400);

        // Reads are in the log of the platform, without the value.
        Response events = asAdmin()
                .queryParam("platform", true)
                .queryParam("action", "secrets.read")
                .queryParam("subject", "secret/" + name)
                .get("/api/v1/audit-events");
        events.then().statusCode(200).body("channel", hasItem("EXTENSION")).body("actor", hasItem(ada));
        assertThat(events.asString()).contains(NOTIFY).doesNotContain(value);
    }

    @Test
    void aCredentialOfTheInstallationMeantForAnExtensionIsReadByItOnly() throws Exception {
        String name = name();
        String value = value();
        storeOfInstallation(name, value, TODO).then().statusCode(201);

        resolved(in(ada, acme), TODO, name).then().statusCode(200).body("sha256", equalTo(sha256(value)));
        resolved(in(ada, acme), NOTIFY, name).then().statusCode(404);
        assertThat(resolveOutsideRequests(NOTIFY, name)).isEmpty();
    }

    // Acceptance 3.

    @Test
    void theCredentialOfTheOrganizationWinsOverTheOneOfTheInstallation() throws NoSuchAlgorithmException {
        String name = name();
        String shared = value();
        String own = value();
        storeOfInstallation(name, shared, null).then().statusCode(201);
        storeOfOrganization(name, own, null);

        resolved(in(ada, acme), NOTIFY, name).then().statusCode(200).body("sha256", equalTo(sha256(own)));
        // An organization without one of its own reads the one of the installation.
        String globexPerson = register(globex);
        resolved(in(globexPerson, globex), NOTIFY, name)
                .then()
                .statusCode(200)
                .body("sha256", equalTo(sha256(shared)))
                .body("sha256", not(equalTo(sha256(own))));
        // The read of the own one is in the log of the organization.
        in(boss, acme)
                .queryParam("action", "secrets.read")
                .queryParam("subject", "secret/" + name)
                .get("/api/v1/organizations/" + acme + "/audit-events")
                .then()
                .statusCode(200)
                .body("[0].outcome", equalTo("SUCCEEDED"));
    }

    @Test
    void anOrganizationCredentialForAnotherExtensionLeavesTheOneOfTheInstallation() throws NoSuchAlgorithmException {
        String name = name();
        String shared = value();
        storeOfInstallation(name, shared, null).then().statusCode(201);
        storeOfOrganization(name, value(), TODO);

        resolved(in(ada, acme), NOTIFY, name).then().statusCode(200).body("sha256", equalTo(sha256(shared)));
    }

    // Rows bound to their scope, and the rotation.

    @Test
    void aRowMovedBetweenAnOrganizationAndTheInstallationDoesNotDecrypt() throws SQLException {
        String name = name();
        String own = value();
        storeOfInstallation(name, value(), null).then().statusCode(201);
        storeOfOrganization(name, own, TODO);
        writeInstallationRow(name, organizationRow(acme, name));

        Response refused = resolved(in(ada, acme), NOTIFY, name);
        refused.then()
                .statusCode(503)
                .body(
                        "detail",
                        equalTo("The credential " + name
                                + " cannot be decrypted with the master keys of the installation."));
        assertThat(refused.asString()).doesNotContain(own);
        asAdmin()
                .queryParam("platform", true)
                .queryParam("action", "secrets.read")
                .queryParam("subject", "secret/" + name)
                .get("/api/v1/audit-events")
                .then()
                .body("[0].outcome", equalTo("FAILED"));
    }

    @Test
    void theRotationMovesTheCredentialsOfTheInstallationToo() throws Exception {
        String name = name();
        String value = value();
        storeOfInstallation(name, value, null).then().statusCode(201);
        writeInstallationRow(name, SecretRows.sealFormerOfInstallation(name, value));
        assertThat(resolveOutsideRequests(NOTIFY, name)).contains(value);

        asAdmin()
                .get("/api/v1/platform/secrets/keys")
                .then()
                .statusCode(200)
                .body("credentials." + SecretRows.formerId(), org.hamcrest.Matchers.greaterThanOrEqualTo(1));
        asAdmin().post("/api/v1/platform/secrets/re-encryption").then().statusCode(200);

        SecretRows.Row row = installationRow(name);
        assertThat(row.keyId()).isEqualTo(SecretRows.currentId());
        assertThat(SecretRows.openOfInstallation(name, row)).isEqualTo(value);
    }
}
