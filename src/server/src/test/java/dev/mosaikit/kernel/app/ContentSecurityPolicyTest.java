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
import static org.hamcrest.Matchers.hasItem;

import dev.mosaikit.kernel.core.data.RowSecurity;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.sql.SQLException;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The external origins of the content security policy (MK-128), through the header the kernel
 * actually sends: listed by an administrator of the installation, added to {@code connect-src} and
 * {@code img-src} only, audited, and out of reach of administrators of organizations and of the SQL of
 * extensions.
 */
@QuarkusTest
@TestProfile(ContentSecurityPolicyTest.Enforced.class)
@Tag("MK-128")
class ContentSecurityPolicyTest {

    static final String PASSWORD = "a long enough password";
    static final String CONFIGURED = "https://basemaps.example.org";
    static final String POLICY = "/api/v1/platform/content-security-policy";
    static final String ORIGINS = POLICY + "/origins";

    /** The policy of production, with one origin of the configuration of the installation. */
    public static class Enforced implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of(
                    "mosaikit.content-security-policy.enabled",
                    "true",
                    "mosaikit.content-security-policy.allowed-origins",
                    CONFIGURED + "/");
        }
    }

    @Inject
    AgroalDataSource dataSource;

    @Inject
    RowSecurity rowSecurity;

    /** The header of an answer of the kernel, by directive. */
    private static Map<String, List<String>> header() {
        return header("/");
    }

    private static Map<String, List<String>> header(String path) {
        String policy = anonymous().get(path).then().extract().header("Content-Security-Policy");
        assertThat(policy).isNotNull();
        Map<String, List<String>> directives = new java.util.LinkedHashMap<>();
        for (String directive : policy.split(";")) {
            List<String> parts = Arrays.asList(directive.trim().split("\\s+"));
            directives.put(parts.getFirst(), parts.subList(1, parts.size()));
        }
        return directives;
    }

    private static String origin() {
        return "https://" + unique("tiles").toLowerCase(java.util.Locale.ROOT) + ".example.org:8443";
    }

    // Acceptance 1 and 2: the header before and after.

    @Test
    void anOriginListedByAnAdministratorOfTheInstallationIsAddedToDataAndImagesOnly() {
        String origin = origin();
        Map<String, List<String>> before = header();
        assertThat(before.get("connect-src")).containsExactly("'self'", CONFIGURED);
        assertThat(before.get("img-src")).containsExactly("'self'", CONFIGURED);
        assertThat(before.get("default-src")).containsExactly("'self'");
        assertThat(before.get("connect-src")).doesNotContain(origin);

        asAdmin()
                .body(Map.of("origin", origin.toUpperCase(java.util.Locale.ROOT) + "/"))
                .post(ORIGINS)
                .then()
                .statusCode(201)
                .body("origin", equalTo(origin))
                .body("source", equalTo("ADMINISTRATION"));
        asAdmin().body(Map.of("origin", origin)).post(ORIGINS).then().statusCode(409);

        Map<String, List<String>> after = header();
        assertThat(after.get("connect-src")).contains("'self'", CONFIGURED, origin);
        assertThat(after.get("img-src")).contains("'self'", CONFIGURED, origin);
        // Everything else stays as it was: no external code, styles, frames or workers.
        for (String directive :
                List.of("default-src", "style-src", "object-src", "base-uri", "form-action", "frame-ancestors")) {
            assertThat(after.get(directive)).as(directive).isEqualTo(before.get(directive));
        }
        assertThat(after).doesNotContainKeys("script-src", "worker-src", "frame-src", "font-src");

        // Visible in the administration, with the origin of the configuration.
        asAdmin()
                .get(POLICY)
                .then()
                .statusCode(200)
                .body("enabled", equalTo(true))
                .body("origins.origin", hasItem(origin))
                .body("origins.origin", hasItem(CONFIGURED))
                .body("origins.find { it.origin == '" + CONFIGURED + "' }.source", equalTo("CONFIGURATION"));

        asAdmin().queryParam("origin", origin).delete(ORIGINS).then().statusCode(204);
        assertThat(header().get("connect-src")).doesNotContain(origin);
        assertThat(header()).isEqualTo(before);
        asAdmin().queryParam("origin", origin).delete(ORIGINS).then().statusCode(404);
        // An origin of the configuration changes only with the configuration.
        asAdmin().queryParam("origin", CONFIGURED).delete(ORIGINS).then().statusCode(409);
    }

    @Test
    void onlyOriginsSchemeHostAndPortAreAccepted() {
        for (String refused : List.of(
                "*",
                "https://*",
                "https://*.org",
                "https://a.*.example.org",
                "https://*.*.example.org",
                "https:",
                "data:",
                "blob:",
                "'unsafe-inline'",
                "https://a.example.org/path",
                "https://a.example.org?x=1",
                "https://user@a.example.org",
                "https://a.example.org 'unsafe-eval'",
                "https://a.example.org; script-src *",
                "javascript://a.example.org",
                "ftp://a.example.org",
                "https://a.example.org:0",
                "https://a.example.org:99999",
                "https://256.1.1.1",
                "https://-a.example.org",
                "")) {
            assertThat(asAdmin().body(Map.of("origin", refused)).post(ORIGINS).statusCode())
                    .as(refused)
                    .isEqualTo(400);
        }
        assertThat(header().get("connect-src")).containsExactly("'self'", CONFIGURED);
    }

    // Acceptance 3 and security.

    @Test
    void changesAreAuditedInTheLogOfThePlatform() {
        String origin = origin();
        asAdmin().body(Map.of("origin", origin)).post(ORIGINS).then().statusCode(201);
        asAdmin().queryParam("origin", origin).delete(ORIGINS).then().statusCode(204);

        asAdmin()
                .queryParam("platform", true)
                .queryParam("subject", "origin/" + origin)
                .get("/api/v1/audit-events")
                .then()
                .statusCode(200)
                .body("action", hasItem("content-security-policy.origin-added"))
                .body("action", hasItem("content-security-policy.origin-removed"))
                .body("actor", hasItem("admin"));
    }

    @Test
    void neitherAnAdministratorOfAnOrganizationNorTheSqlOfAnExtensionWidensThePolicy() throws SQLException {
        String slug = unique("csp");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        String boss = unique("csp") + "@example.org";
        anonymous()
                .body(Map.of("organization", slug, "email", boss, "displayName", "B", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", slug, boss)
                .then()
                .statusCode(200);
        RequestSpecification organizationAdmin = as(boss, PASSWORD).header("X-Mosaikit-Organization", slug);

        organizationAdmin.body(Map.of("origin", origin())).post(ORIGINS).then().statusCode(403);
        as(boss, PASSWORD)
                .header("X-Mosaikit-Organization", slug)
                .get(POLICY)
                .then()
                .statusCode(403);
        anonymous().body(Map.of("origin", origin())).post(ORIGINS).then().statusCode(401);

        // The member role, as which requests and the SQL of extensions run, cannot touch the table.
        String role = rowSecurity.role().orElseThrow();
        try (var connection = dataSource.getConnection();
                var asMember = connection.prepareStatement("select set_config('role', ?, false)");
                var statement = connection.createStatement()) {
            asMember.setString(1, role);
            asMember.execute();
            assertThatThrownBy(() -> statement.executeUpdate("insert into mk_kernel.csp_origin"
                            + " (origin, added_at, added_by) values ('https://evil.example.org', now(), 'x')"))
                    .isInstanceOf(SQLException.class)
                    .hasMessageContaining("permission denied");
        }
        assertThat(Optional.ofNullable(header().get("connect-src")).orElseThrow())
                .isNotEmpty()
                .doesNotContain("https://evil.example.org");
    }

    // MK-100: the embed mode of the shell keeps the policy and changes frame-ancestors only.

    @Test
    @Tag("MK-100")
    void theEmbedModeKeepsThePolicyAndLetsOnlyTheSitesOfItsOrganizationFrameIt() {
        String slug = unique("embedcsp");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        asAdmin()
                .body(Map.of("origin", "https://www.example.org"))
                .post("/api/v1/organizations/{slug}/embed-sites", slug)
                .then()
                .statusCode(201);

        Map<String, List<String>> console = header();
        Map<String, List<String>> embedded = header("/embed/" + slug + "/app/notes");
        assertThat(console.get("frame-ancestors")).containsExactly("'none'");
        assertThat(embedded.get("frame-ancestors")).containsExactly("'self'", "https://www.example.org");
        assertThat(anonymous()
                        .get("/embed/" + slug + "/app/notes")
                        .then()
                        .extract()
                        .header("X-Frame-Options"))
                .isNull();
        // Every other directive as for the console: the embedded view loads nothing more.
        Map<String, List<String>> rest = new java.util.LinkedHashMap<>(embedded);
        rest.remove("frame-ancestors");
        Map<String, List<String>> consoleRest = new java.util.LinkedHashMap<>(console);
        consoleRest.remove("frame-ancestors");
        assertThat(rest).isEqualTo(consoleRest);
    }
}
