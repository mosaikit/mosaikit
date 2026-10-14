// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;

import dev.mosaikit.kernel.api.permission.AccessDeniedException;
import dev.mosaikit.kernel.api.quota.QuotaExceededException;
import dev.mosaikit.kernel.api.secrets.SecretsUnavailableException;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * A documented exception of a bean of the kernel leaves the transaction of the extension usable (#126):
 * the Java code of an extension, through {@link KeptTransactionProbe}, calls the bean in its own
 * transaction, catches the exception the API documents, writes, and the write commits.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
class KeptTransactionTest {

    static final String PASSWORD = "a long enough password";

    @Inject
    AgroalDataSource dataSource;

    private String acme;
    private String boss;
    private String ada;

    @BeforeEach
    void people() {
        acme = unique("kept");
        asAdmin()
                .body(Map.of("slug", acme, "name", acme, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        boss = register();
        ada = register();
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", acme, boss)
                .then()
                .statusCode(200);
    }

    private String register() {
        String email = unique("kept") + "@example.org";
        anonymous()
                .body(Map.of("organization", acme, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private RequestSpecification in(String person) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", acme);
    }

    /** Calls the bean as {@code person}, and checks the exception caught and that the write committed. */
    private void keeps(String person, String call, String target, Class<? extends RuntimeException> documented) {
        String note = unique("after");
        RequestSpecification request = in(person);
        if (target != null) {
            request = request.queryParam("target", target);
        }
        request.post("/api/v1/test/kept-transaction/{call}/{id}", call, note)
                .then()
                .log()
                .ifValidationFails()
                .statusCode(200)
                .body("caught", equalTo(documented.getName()))
                .body("active", equalTo(true));
        in(person)
                .get("/api/v1/test/resources/{extension}/note/{id}", KeptTransactionProbe.RESOURCES, note)
                .then()
                .statusCode(200)
                .body("title", equalTo("After " + call));
    }

    /** A credential whose master key the installation no longer has: it cannot be decrypted. */
    private void undecryptable(String name) throws SQLException {
        in(boss).body(Map.of("name", name, "kind", "token", "value", "sk-kept"))
                .post("/api/v1/organizations/" + acme + "/secrets")
                .then()
                .statusCode(201);
        try (var connection = dataSource.getConnection()) {
            try (var statement = connection.createStatement()) {
                statement.execute("select set_config('role', 'none', false)");
            }
            try (var statement = connection.prepareStatement("update mk_kernel.secret set key_id = 'gone'"
                    + " where name = ? and organization_id = (select id from mk_kernel.organization where slug = ?)")) {
                statement.setString(1, name);
                statement.setString(2, acme);
                assertThat(statement.executeUpdate()).isEqualTo(1);
            }
        }
    }

    @Test
    @Tag("MK-062")
    void secretsUnavailableLeavesTheTransactionUsable() throws SQLException {
        undecryptable("undecryptable");
        keeps(ada, "secrets-find", "undecryptable", SecretsUnavailableException.class);
        keeps(ada, "secrets-inactive", null, IllegalArgumentException.class);
    }

    @Test
    @Tag("MK-127")
    void secretsUnavailableOnResolveLeavesTheTransactionUsable() throws SQLException {
        undecryptable("unresolvable");
        keeps(ada, "secrets-resolve", "unresolvable", SecretsUnavailableException.class);
    }

    @Test
    @Tag("MK-054")
    void resourcesRefusalsLeaveTheTransactionUsable() {
        keeps(ada, "resources-unregistered", null, NoSuchElementException.class);
        keeps(ada, "resources-undeclared", null, IllegalArgumentException.class);
    }

    @Test
    @Tag("MK-055")
    void sharingRefusalsLeaveTheTransactionUsable() {
        String doc = unique("doc");
        in(boss).body(Map.of("title", "Of the boss", "link", "/app/docs/" + doc))
                .contentType("application/json")
                .put("/api/v1/test/resources/{extension}/doc/{id}", SharingTest.EXTENSION, doc)
                .then()
                .statusCode(200);
        keeps(ada, "sharing-denied", doc, AccessDeniedException.class);
        keeps(ada, "sharing-unregistered", null, NoSuchElementException.class);
        keeps(boss, "sharing-level", doc, IllegalArgumentException.class);
    }

    @Test
    @Tag("MK-056")
    void permissionRefusalsLeaveTheTransactionUsable() {
        keeps(ada, "holders-inactive", null, IllegalArgumentException.class);
        keeps(ada, "permissions-denied", null, AccessDeniedException.class);
    }

    @Test
    @Tag("MK-041")
    void fileStorageRefusalsLeaveTheTransactionUsable() {
        keeps(ada, "files-missing", null, NoSuchElementException.class);
    }

    @Test
    @Tag("MK-076")
    void quotaExceededLeavesTheTransactionUsable() {
        asAdmin()
                .body(Map.of("limit", 10))
                .put("/api/v1/organizations/" + acme + "/quotas/" + QuotaApiTest.RENDERS)
                .then()
                .statusCode(200);
        keeps(ada, "quotas-exceeded", null, QuotaExceededException.class);
    }

    @Test
    @Tag("MK-059")
    void auditRefusalsLeaveTheTransactionUsable() {
        keeps(ada, "audit-inactive", null, IllegalArgumentException.class);
    }

    @Test
    @Tag("MK-085")
    void eventRefusalsLeaveTheTransactionUsable() {
        keeps(ada, "events-invalid", null, IllegalArgumentException.class);
    }
}
