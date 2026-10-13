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
class ExtensionMigrationsTest {

    @Inject
    AgroalDataSource dataSource;

    @Test
    void migratesTheSchemaOfEachActiveExtensionAtStart() throws SQLException {
        try (var connection = dataSource.getConnection();
                var statement = connection.createStatement();
                var result = statement.executeQuery("select name from ext_test_schema.item where id = 1")) {
            assertThat(result.next()).isTrue();
            assertThat(result.getString("name")).isEqualTo("migrated");
        }
    }

    @Test
    void keepsAFlywayHistoryInTheExtensionSchema() throws SQLException {
        try (var connection = dataSource.getConnection();
                var statement = connection.createStatement();
                var result = statement.executeQuery(
                        "select count(*) from ext_test_schema.flyway_schema_history where success and type = 'SQL'")) {
            assertThat(result.next()).isTrue();
            assertThat(result.getInt(1)).isEqualTo(2);
        }
    }

    @Test
    void protectsExtensionApisByDefault() {
        anonymous().get("/api/v1/ext/anything").then().statusCode(401);
    }

    @Test
    void servesOnlyTheApisOfActiveExtensions() {
        // dev.mosaikit.test.java declares the API "test-java" but is RESTART_REQUIRED in tests.
        asAdmin()
                .get("/api/v1/ext/test-java/anything")
                .then()
                .statusCode(404)
                .contentType("application/problem+json")
                .body("detail", equalTo("No active extension provides this API."));
        asAdmin().get("/api/v1/ext/").then().statusCode(404);
    }
}
