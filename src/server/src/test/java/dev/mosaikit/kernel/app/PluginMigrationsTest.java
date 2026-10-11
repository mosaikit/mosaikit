// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;

import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.sql.SQLException;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@QuarkusTest
@Tag("MK-011")
class PluginMigrationsTest {

    @Inject
    AgroalDataSource dataSource;

    @Test
    void migratesTheSchemaOfEachActivePluginAtStart() throws SQLException {
        try (var connection = dataSource.getConnection();
                var statement = connection.createStatement();
                var result = statement.executeQuery("select name from p_test_schema.item where id = 1")) {
            assertThat(result.next()).isTrue();
            assertThat(result.getString("name")).isEqualTo("migrated");
        }
    }

    @Test
    void keepsAFlywayHistoryInThePluginSchema() throws SQLException {
        try (var connection = dataSource.getConnection();
                var statement = connection.createStatement();
                var result = statement.executeQuery(
                        "select count(*) from p_test_schema.flyway_schema_history where success and type = 'SQL'")) {
            assertThat(result.next()).isTrue();
            assertThat(result.getInt(1)).isEqualTo(2);
        }
    }

    @Test
    void protectsPluginApisByDefault() {
        anonymous().get("/api/v1/p/anything").then().statusCode(401);
    }

    @Test
    void servesOnlyTheApisOfActivePlugins() {
        // dev.mosaikit.test.java declares the API "test-java" but is RESTART_REQUIRED in tests.
        asAdmin()
                .get("/api/v1/p/test-java/anything")
                .then()
                .statusCode(404)
                .contentType("application/problem+json")
                .body("detail", equalTo("No active plugin provides this API."));
        asAdmin().get("/api/v1/p/").then().statusCode(404);
    }
}
