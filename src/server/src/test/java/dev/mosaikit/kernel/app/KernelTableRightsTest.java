// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.hamcrest.Matchers.equalTo;

import dev.mosaikit.kernel.core.data.RowSecurity;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The tables of the installation that have neither row-level security nor an organization (MK-019,
 * ADR-0018): the member role of requests, as which the SQL of extensions runs, reads them but cannot
 * write them; the kernel writes them as the owner, and its features keep working.
 */
@QuarkusTest
@Tag("MK-019")
class KernelTableRightsTest {

    static final String PASSWORD = "a long enough password";

    /** A statement that would write each table, whatever its columns. */
    static final List<String> TABLES = List.of(
            "platform_setting",
            "user_account",
            "account_session",
            "remember_token",
            "email_confirmation",
            "password_link",
            "access_key",
            "service_identity",
            "service_key",
            "organization",
            "organization_email_domain",
            "sharing_level");

    @Inject
    AgroalDataSource dataSource;

    @Inject
    RowSecurity rowSecurity;

    private Connection asMember() throws SQLException {
        Connection connection = dataSource.getConnection();
        try (var statement = connection.prepareStatement("select set_config('role', ?, false)")) {
            statement.setString(1, rowSecurity.role().orElseThrow());
            statement.execute();
        }
        return connection;
    }

    @Test
    void theMemberRoleReadsButCannotWriteTheTablesOfTheInstallation() throws SQLException {
        try (Connection connection = asMember();
                var statement = connection.createStatement()) {
            for (String table : TABLES) {
                // Reading stays allowed: the kernel reads them in requests.
                // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
                statement
                        .executeQuery("select count(*) from mk_kernel." + table)
                        .close();
                // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
                assertThatThrownBy(() -> statement.executeUpdate("delete from mk_kernel." + table))
                        .as(table)
                        .isInstanceOf(SQLException.class)
                        .hasMessageContaining("permission denied");
                // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
                assertThatThrownBy(() -> statement.executeUpdate(
                                "update mk_kernel." + table + " set " + column(table) + " = " + column(table)))
                        .as(table)
                        .isInstanceOf(SQLException.class)
                        .hasMessageContaining("permission denied");
                // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
                assertThatThrownBy(() -> statement.execute("truncate mk_kernel." + table + " cascade"))
                        .as(table)
                        .isInstanceOf(SQLException.class);
            }
            assertThatThrownBy(() -> statement.executeUpdate("insert into mk_kernel.platform_setting"
                            + " (name, value, updated_at, updated_by) values ('registration', 'false', now(), 'x')"))
                    .isInstanceOf(SQLException.class)
                    .hasMessageContaining("permission denied");
        }
    }

    private static String column(String table) {
        return switch (table) {
            case "platform_setting" -> "value";
            case "sharing_level" -> "rank";
            case "organization_email_domain" -> "organization_id";
            default -> "id";
        };
    }

    @Test
    void theFeaturesOfTheKernelStillWriteThem() {
        // The settings of the platform.
        asAdmin()
                .body(Map.of("registration", false))
                .put("/api/v1/platform/settings")
                .then()
                .statusCode(200);
        asAdmin().get("/api/v1/platform/settings").then().statusCode(200).body("registration", equalTo(false));
        asAdmin()
                .body(Map.of("registration", true))
                .put("/api/v1/platform/settings")
                .then()
                .statusCode(200);

        // An organization, an account that registers, signs in and makes an access key.
        String slug = unique("rights");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        String email = unique("rights") + "@example.org";
        anonymous()
                .body(Map.of("organization", slug, "email", email, "displayName", "Ada", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        String key = as(email, PASSWORD)
                .body(Map.of("name", "reports", "organization", slug, "write", false))
                .post("/api/v1/accounts/me/access-keys")
                .then()
                .statusCode(201)
                .extract()
                .path("secret");
        assertThat(key).isNotBlank();
        // Its use is recorded (access_key), and the person reads their account with it.
        anonymous()
                .header("Authorization", "Bearer " + key)
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(200)
                .body("username", equalTo(email));
    }
}
