// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import io.restassured.specification.RequestSpecification;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.config.Config;
import org.eclipse.microprofile.config.ConfigProvider;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Row-level security of the data of organizations (MK-019): a plugin that reads its table without
 * any filter still sees only the rows of the organization of the request.
 */
@QuarkusTest
@Tag("MK-019")
class RowSecurityTest {

    private static final String PASSWORD = "a long enough password";

    private static String organization() {
        String slug = unique("rls");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static RequestSpecification member(String slug) {
        String email = unique("rls") + "@example.org";
        anonymous()
                .body(Map.of("organization", slug, "email", email, "displayName", "Ada", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return as(email, PASSWORD).header("X-Mosaikit-Organization", slug).contentType(ContentType.TEXT);
    }

    @Test
    void showsEachOrganizationOnlyItsOwnRowsWhateverTheQuery() throws SQLException {
        String acme = organization();
        String globex = organization();
        RequestSpecification ada = member(acme);
        RequestSpecification bea = member(globex);

        ada.body("from acme").post("/api/v1/test/scoped-notes").then().statusCode(204);
        bea.body("from globex").post("/api/v1/test/scoped-notes").then().statusCode(204);

        ada.get("/api/v1/test/scoped-notes").then().statusCode(200).body("$", equalTo(List.of("from acme")));
        bea.get("/api/v1/test/scoped-notes").then().statusCode(200).body("$", equalTo(List.of("from globex")));
        // Without an organization, a request sees no row at all.
        asAdmin().get("/api/v1/test/scoped-notes").then().statusCode(200).body("$", hasSize(0));

        // The owner, as at start and in migrations, sees every row: a plain connection, not one of
        // the pool, which the tests hand out inside a request context.
        Config config = ConfigProvider.getConfig();
        try (var connection = DriverManager.getConnection(
                        config.getValue("quarkus.datasource.jdbc.url", String.class),
                        config.getValue("quarkus.datasource.username", String.class),
                        config.getValue("quarkus.datasource.password", String.class));
                var statement = connection.createStatement();
                var result = statement.executeQuery(
                        "select count(*) from p_test_schema.scoped_note where text in ('from acme', 'from globex')")) {
            result.next();
            assertThat(result.getInt(1)).isGreaterThanOrEqualTo(2);
        }
    }

    @Test
    void refusesToWriteRowsOfAnotherOrganization() {
        String acme = organization();
        String globex = organization();
        String globexId = asAdmin().get("/api/v1/organizations/{slug}", globex).path("id");

        member(acme)
                .body("forged")
                .post("/api/v1/test/scoped-notes/{organization}", globexId)
                .then()
                .statusCode(403)
                // insufficient_privilege: the row violates the policy.
                .body("[0]", equalTo("42501"));
    }
}
