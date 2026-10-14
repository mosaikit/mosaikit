// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;

import dev.mosaikit.kernel.core.data.RowSecurity;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.RestAssured;
import io.restassured.config.EncoderConfig;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The content of files whose record is gone leaves the store only through an explicit clean-up, after
 * the retention, never on a wrong setting, and audited (#102): files of deleted teams and
 * organizations, of deleted files, and of extensions that are no longer installed.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-041")
class FileRemovalsTest {

    static final String EXTENSION = FileStorageTest.EXTENSION;
    static final String FILES = "/api/v1/files/" + EXTENSION;
    static final String REMOVALS = "/api/v1/platform/files/removals";
    static final String CLEAN_UP = "/api/v1/platform/files/clean-up";
    static final String PASSWORD = FileStorageTest.PASSWORD;
    static final byte[] CONTENT = "the content of a file".getBytes(StandardCharsets.US_ASCII);

    @Inject
    AgroalDataSource dataSource;

    @Inject
    RowSecurity rowSecurity;

    private String acme;
    private String ada;

    @BeforeEach
    void people() {
        acme = unique("removals");
        asAdmin()
                .body(Map.of("slug", acme, "name", acme, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        ada = unique("removals") + "@example.org";
        anonymous()
                .body(Map.of("organization", acme, "email", ada, "displayName", "Ada", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
    }

    private RequestSpecification ada() {
        return as(ada, PASSWORD)
                .header("X-Mosaikit-Organization", acme)
                .config(RestAssured.config()
                        .encoderConfig(EncoderConfig.encoderConfig()
                                .appendDefaultContentCharsetToContentTypeIfUndefined(false)));
    }

    private String stored(String query) {
        return ada().contentType("application/octet-stream")
                .body(CONTENT)
                .post(FILES + query)
                .then()
                .statusCode(201)
                .extract()
                .path("id");
    }

    private String organizationId() {
        return asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");
    }

    private Path content(String organization, String extension, String id) {
        return Path.of("target", "files", organization, extension, id);
    }

    /** A connection as the owner of the tables, whatever the request context of the test thread. */
    private Connection owner() throws SQLException {
        Connection connection = dataSource.getConnection();
        try (var statement = connection.createStatement()) {
            statement.execute("set role none");
        }
        return connection;
    }

    private long count(String sql, Object... values) throws SQLException {
        try (Connection connection = owner();
                PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int i = 0; i < values.length; i++) {
                statement.setObject(i + 1, values[i]);
            }
            try (ResultSet result = statement.executeQuery()) {
                result.next();
                return result.getLong(1);
            }
        }
    }

    private void execute(String sql, Object... values) throws SQLException {
        try (Connection connection = owner();
                PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int i = 0; i < values.length; i++) {
                statement.setObject(i + 1, values[i]);
            }
            statement.executeUpdate();
        }
    }

    private String reason(String id) throws SQLException {
        try (Connection connection = owner();
                PreparedStatement statement =
                        connection.prepareStatement("select reason from mk_kernel.file_removal where file_id = ?")) {
            statement.setObject(1, UUID.fromString(id));
            try (ResultSet result = statement.executeQuery()) {
                return result.next() ? result.getString(1) : null;
            }
        }
    }

    /** As if the retention had passed since these files were queued. */
    private void pastTheRetention(String... ids) throws SQLException {
        for (String id : ids) {
            execute(
                    "update mk_kernel.file_removal set queued_at = now() - interval '31 days' where file_id = ?",
                    UUID.fromString(id));
        }
    }

    @Test
    void theFilesOfADeletedTeamLeaveTheStoreOnlyAtACleanUpAfterTheRetention() throws Exception {
        String team = ada().body(Map.of("name", "Roads", "description", "", "visibility", "private"))
                .contentType("application/json")
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
        String ofTeam = stored("?name=roads.bin&team=" + team);
        String ofOrganization = stored("?name=kept.bin");
        Path teamContent = content(organizationId(), EXTENSION, ofTeam);
        assertThat(teamContent).exists();

        ada().delete("/api/v1/teams/" + team).then().statusCode(204);

        // The record went with the team, the content stays, queued.
        assertThat(count("select count(*) from mk_kernel.stored_file where id = ?", UUID.fromString(ofTeam)))
                .isZero();
        assertThat(reason(ofTeam)).isEqualTo("team");
        assertThat(teamContent).exists();
        asAdmin().get(REMOVALS).then().statusCode(200).body("files", greaterThanOrEqualTo(1));

        // Before the retention, a clean-up removes nothing of it.
        asAdmin().post(CLEAN_UP).then().statusCode(200);
        assertThat(teamContent).exists();
        assertThat(reason(ofTeam)).isEqualTo("team");

        pastTheRetention(ofTeam);
        asAdmin()
                .post(CLEAN_UP)
                .then()
                .statusCode(200)
                .body("removed", greaterThanOrEqualTo(1))
                .body("reasons.team", greaterThanOrEqualTo(1));
        assertThat(teamContent).doesNotExist();
        assertThat(reason(ofTeam)).isNull();
        // The other files stay.
        assertThat(content(organizationId(), EXTENSION, ofOrganization)).exists();
        ada().get(FILES + "/" + ofOrganization + "/content").then().statusCode(200);

        // Audited in the log of the platform.
        List<Map<String, Object>> events = asAdmin()
                .queryParam("platform", true)
                .queryParam("limit", 500)
                .get("/api/v1/audit-events")
                .then()
                .statusCode(200)
                .extract()
                .path("findAll { it.action == 'files.cleaned' }");
        assertThat(events).isNotEmpty();
    }

    @Test
    void theFilesOfADeletedOrganizationAndADeletedFileAreQueuedToo() throws Exception {
        String deleted = stored("?name=deleted.bin");
        ada().delete(FILES + "/" + deleted).then().statusCode(204);
        assertThat(reason(deleted)).isEqualTo("file");

        String organization = organizationId();
        String ofOrganization = stored("?name=of-the-organization.bin");
        Path kept = content(organization, EXTENSION, ofOrganization);
        execute("delete from mk_kernel.organization where id = ?", UUID.fromString(organization));
        assertThat(reason(ofOrganization)).isEqualTo("organization");
        assertThat(kept).exists();

        pastTheRetention(deleted, ofOrganization);
        asAdmin().post(CLEAN_UP).then().statusCode(200).body("reasons.organization", greaterThanOrEqualTo(1));
        assertThat(kept).doesNotExist();
        assertThat(reason(deleted)).isNull();
        assertThat(reason(ofOrganization)).isNull();
    }

    @Test
    void theFilesOfAnUninstalledExtensionLeaveOnlyWhenAPlatformAdministratorAsks() throws Exception {
        String gone = "dev.example." + unique("gone").replace('-', '.');
        String organization = organizationId();
        UUID id = UUID.randomUUID();
        String key = organization + "/" + gone + "/" + id;
        execute(
                "insert into mk_kernel.stored_file (id, organization_id, extension_id, name, content_type, size,"
                        + " checksum, storage_key, created_at, updated_at)"
                        + " values (?, ?, ?, 'old.bin', 'application/octet-stream', ?, 'x', ?, now(), now())",
                id,
                UUID.fromString(organization),
                gone,
                (long) CONTENT.length,
                key);
        Path left = content(organization, gone, id.toString());
        Files.createDirectories(left.getParent());
        Files.write(left, CONTENT);

        asAdmin().get(REMOVALS).then().statusCode(200).body("uninstalled.extension", hasItem(gone));
        // A clean-up does not touch it until it is asked for.
        asAdmin().post(CLEAN_UP).then().statusCode(200);
        assertThat(left).exists();

        // Not for an installed extension, nor one without files.
        asAdmin()
                .post(REMOVALS + "/extensions/" + EXTENSION)
                .then()
                .statusCode(409)
                .body("detail", containsString("is installed"));
        asAdmin().post(REMOVALS + "/extensions/dev.example.nothing").then().statusCode(404);
        // Platform administrators only.
        ada().post(REMOVALS + "/extensions/" + gone).then().statusCode(403);

        asAdmin()
                .post(REMOVALS + "/extensions/" + gone)
                .then()
                .statusCode(200)
                .body("extension", equalTo(gone))
                .body("files", equalTo(1));
        assertThat(reason(id.toString())).isEqualTo("extension");
        // The record stays until the clean-up after the retention.
        asAdmin().post(CLEAN_UP).then().statusCode(200);
        assertThat(count("select count(*) from mk_kernel.stored_file where id = ?", id))
                .isOne();
        assertThat(left).exists();

        pastTheRetention(id.toString());
        asAdmin().post(CLEAN_UP).then().statusCode(200).body("reasons.extension", equalTo(1));
        assertThat(count("select count(*) from mk_kernel.stored_file where id = ?", id))
                .isZero();
        assertThat(left).doesNotExist();
        asAdmin().get(REMOVALS).then().statusCode(200).body("uninstalled.extension", not(hasItem(gone)));
    }

    @Test
    void theFilesOfAnExtensionInstalledAgainAreKept() throws Exception {
        String id = stored("?name=installed-again.bin");
        // As if it had been queued while the extension was not installed.
        execute(
                "insert into mk_kernel.file_removal (storage_key, file_id, organization_id, extension_id, size,"
                        + " reason, queued_at) select storage_key, id, organization_id, extension_id, size,"
                        + " 'extension', now() - interval '31 days' from mk_kernel.stored_file where id = ?",
                UUID.fromString(id));

        asAdmin().post(CLEAN_UP).then().statusCode(200).body("kept", greaterThanOrEqualTo(1));

        assertThat(reason(id)).isNull();
        ada().get(FILES + "/" + id + "/content").then().statusCode(200);
    }

    @Test
    void aStoreThatHoldsNoneOfTheRecordedFilesRemovesNothing() throws Exception {
        String queued = stored("?name=queued.bin");
        ada().delete(FILES + "/" + queued).then().statusCode(204);
        pastTheRetention(queued);
        // The newest files have no content where the store looks: as with a wrong directory.
        List<Path> moved = new ArrayList<>();
        String organization = organizationId();
        for (int i = 0; i < 5; i++) {
            Path file = content(organization, EXTENSION, stored("?name=newest-" + i + ".bin"));
            Path aside = file.resolveSibling(file.getFileName() + ".aside");
            Files.move(file, aside);
            moved.add(aside);
        }
        try {
            asAdmin().post(CLEAN_UP).then().statusCode(503).body("detail", containsString("holds none of the files"));
            assertThat(reason(queued)).isEqualTo("file");
        } finally {
            for (Path aside : moved) {
                restore(aside);
            }
        }
        asAdmin().post(CLEAN_UP).then().statusCode(200);
        assertThat(reason(queued)).isNull();
    }

    private static void restore(Path aside) throws IOException {
        String name = aside.getFileName().toString();
        Files.move(aside, aside.resolveSibling(name.substring(0, name.length() - ".aside".length())));
    }

    @Test
    void requestsCannotReadTheQueue() throws SQLException {
        try (Connection connection = dataSource.getConnection();
                var statement = connection.createStatement()) {
            try (var role = connection.prepareStatement("select set_config('role', ?, false)")) {
                role.setString(1, rowSecurity.role().orElseThrow());
                role.execute();
            }
            assertThatThrownBy(() -> statement.executeQuery("select count(*) from mk_kernel.file_removal"))
                    .isInstanceOf(SQLException.class)
                    .hasMessageContaining("permission denied");
            statement.execute("select set_config('role', 'none', false)");
        }
    }
}
