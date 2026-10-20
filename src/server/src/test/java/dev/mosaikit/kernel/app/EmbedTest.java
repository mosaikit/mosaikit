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
import static org.hamcrest.Matchers.hasSize;

import dev.mosaikit.kernel.core.data.RowSecurity;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.ExtractableResponse;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Views of extensions embedded in the pages of other sites (MK-100): the sites that an organization
 * lists are the only ones, with the installation itself, that may frame its addresses {@code
 * /embed/<slug>/...}, and nothing else of the installation may be framed; a resource that the
 * organization shares with the public opens without an account, also through the folders above it
 * (MK-136), and one that it does not share, or that is in the trash (MK-095), does not.
 *
 * <p>The tree of the drive fixture: {@code top} holds the file {@code doc} and the note {@code memo},
 * whose type does not inherit; {@code other} is not shared.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-100")
class EmbedTest {

    static final String EXTENSION = InheritedLevelsTest.EXTENSION;
    static final String PASSWORD = "Correct-Horse-9";
    static final String RESOURCES = "/api/v1/test/resources/" + EXTENSION + "/";
    static final String PROBE = "/api/v1/test/sharing/" + EXTENSION + "/";
    static final String SHARING = "/api/v1/sharing/resources/" + EXTENSION + "/";
    static final String TRASH = "/api/v1/test/trash/" + EXTENSION + "/";
    static final String SITES = "/api/v1/organizations/{slug}/embed-sites";
    static final String SITE = "https://www.example.org";

    @Inject
    AgroalDataSource dataSource;

    @Inject
    RowSecurity rowSecurity;

    private String acme;
    private String globex;
    private String ada;
    private String boss;
    private String dan;
    private String top;
    private String doc;
    private String memo;
    private String other;

    @BeforeEach
    void tree() {
        acme = organization();
        globex = organization();
        ada = register(acme);
        boss = register(acme);
        dan = register(globex);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", acme, boss)
                .then()
                .statusCode(200);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", globex, dan)
                .then()
                .statusCode(200);
        top = unique("top");
        doc = unique("doc");
        memo = unique("memo");
        other = unique("other");
        resource("folder", top, null);
        resource("file", doc, "folder/" + top);
        resource("note", memo, "folder/" + top);
        resource("folder", other, null);
    }

    private static String organization() {
        String slug = unique("embed");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("embed") + "@example.org";
        anonymous()
                .body(Map.of(
                        "organization",
                        organization,
                        "email",
                        email,
                        "displayName",
                        "P " + email,
                        "password",
                        PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    private void resource(String type, String id, String parent) {
        Map<String, Object> body = new HashMap<>(Map.of("title", "Title of " + id, "link", "/app/drive/" + id));
        if (parent != null) {
            body.put("parent", EXTENSION + "/" + parent);
        }
        in(ada, acme).body(body).put(RESOURCES + type + "/" + id).then().statusCode(200);
    }

    /** The headers that decide who may frame an answer of the kernel. */
    private static ExtractableResponse<?> answer(String path) {
        return anonymous().get(path).then().extract();
    }

    private static String frameAncestors(String path) {
        return answer(path).header("Content-Security-Policy");
    }

    private static io.restassured.response.Response openPublic(String organization, String type, String id) {
        return anonymous()
                .get(
                        "/api/v1/sharing/public/{organization}/{extension}/{type}/{id}",
                        organization,
                        EXTENSION,
                        type,
                        id);
    }

    private static String level(RequestSpecification request, String type, String id) {
        return request.get(PROBE + type + "/" + id + "/level")
                .then()
                .statusCode(200)
                .extract()
                .path("level");
    }

    private static List<Map<String, Object>> audit(String organization) {
        String organizationId =
                asAdmin().get("/api/v1/organizations/{slug}", organization).path("id");
        return asAdmin()
                .queryParam("organization", organizationId)
                .queryParam("limit", 500)
                .get("/api/v1/audit-events")
                .then()
                .statusCode(200)
                .extract()
                .path("findAll { it.action.startsWith('organization.embed-site.') }");
    }

    // Acceptance 2: only the sites of the organization frame its views.

    @Test
    void onlyTheSitesThatTheOrganizationListsFrameItsViewsAndNothingElseIsFramed() throws SQLException {
        String view = "/embed/" + acme + "/app/drive/folders?at=" + top;
        // Before any site: the installation itself only, and no X-Frame-Options, which cannot name one.
        assertThat(frameAncestors(view)).isEqualTo("frame-ancestors 'self'");
        assertThat(answer(view).header("X-Frame-Options")).isNull();

        in(boss, acme)
                .body(Map.of("origin", SITE + "/"))
                .post(SITES, acme)
                .then()
                .statusCode(201)
                .body("origin", equalTo(SITE))
                .body("addedBy", equalTo(boss));
        in(boss, acme).body(Map.of("origin", SITE)).post(SITES, acme).then().statusCode(409);
        in(boss, acme)
                .body(Map.of("origin", "http://localhost:5173"))
                .post(SITES, acme)
                .then()
                .statusCode(201);
        in(boss, acme)
                .get(SITES, acme)
                .then()
                .statusCode(200)
                .body("origin", equalTo(List.of("http://localhost:5173", SITE)));

        // The sites of the organization, in the views of that organization only.
        assertThat(frameAncestors(view)).isEqualTo("frame-ancestors 'self' http://localhost:5173 " + SITE);
        assertThat(answer(view).header("X-Frame-Options")).isNull();
        assertThat(frameAncestors("/embed/" + acme + "/shared/a-secret")).contains(SITE);
        assertThat(frameAncestors("/embed/" + globex + "/app/drive")).isEqualTo("frame-ancestors 'self'");
        assertThat(frameAncestors("/embed/No_Such/app/drive")).isEqualTo("frame-ancestors 'self'");
        // The console, its sign-in and the API: framed by no one, also by a listed site.
        for (String path : List.of("/", "/app/drive", "/shared/a-secret", "/embed", "/api/v1/system/info")) {
            assertThat(answer(path).header("X-Frame-Options")).as(path).isEqualTo("DENY");
            assertThat(String.valueOf(frameAncestors(path))).as(path).doesNotContain(SITE);
        }

        // Every change in the audit log of the organization.
        assertThat(audit(acme)).extracting(event -> event.get("action")).containsOnly("organization.embed-site.added");
        in(boss, acme)
                .queryParam("origin", "http://localhost:5173")
                .delete(SITES, acme)
                .then()
                .statusCode(204);
        assertThat(frameAncestors(view)).isEqualTo("frame-ancestors 'self' " + SITE);
        assertThat(audit(acme)).extracting(event -> event.get("action")).contains("organization.embed-site.removed");
        in(boss, acme)
                .queryParam("origin", "http://localhost:5173")
                .delete(SITES, acme)
                .then()
                .statusCode(404);
    }

    @Test
    void onlyTheAdministratorsOfTheOrganizationListSitesAndOnlyOrigins() throws SQLException {
        for (String wrong : List.of(
                "www.example.org",
                "https://www.example.org/page",
                "wss://www.example.org",
                "javascript:alert(1)",
                "https://*.org",
                "")) {
            in(boss, acme)
                    .body(Map.of("origin", wrong))
                    .post(SITES, acme)
                    .then()
                    .statusCode(400);
        }
        in(boss, acme)
                .body(Map.of("origin", "https://*.example.org"))
                .post(SITES, acme)
                .then()
                .statusCode(201);
        // A person of the organization, an administrator of another one, and no one.
        in(ada, acme).get(SITES, acme).then().statusCode(403);
        in(ada, acme)
                .body(Map.of("origin", "https://evil.example.com"))
                .post(SITES, acme)
                .then()
                .statusCode(403);
        in(dan, globex)
                .body(Map.of("origin", "https://evil.example.com"))
                .post(SITES, acme)
                .then()
                .statusCode(403);
        in(dan, globex).get(SITES, globex).then().statusCode(200).body("$", hasSize(0));
        anonymous().get(SITES, acme).then().statusCode(401);
        asAdmin().get(SITES, acme).then().statusCode(200).body("origin", equalTo(List.of("https://*.example.org")));

        // The member role, as which requests and the SQL of extensions run, cannot widen the list.
        String role = rowSecurity.role().orElseThrow();
        try (var connection = dataSource.getConnection();
                var asMember = connection.prepareStatement("select set_config('role', ?, false)");
                var statement = connection.createStatement()) {
            asMember.setString(1, role);
            asMember.execute();
            assertThatThrownBy(() -> statement.executeUpdate("insert into mk_kernel.embed_site"
                            + " (id, organization_id, origin, added_at, added_by) select gen_random_uuid(), id,"
                            + " 'https://evil.example.com', now(), 'x' from mk_kernel.organization"))
                    .isInstanceOf(SQLException.class)
                    .hasMessageContaining("permission denied");
        }
        assertThat(frameAncestors("/embed/" + acme + "/app/drive")).doesNotContain("evil");
    }

    // Acceptance 3: what is shared with the public opens without an account; the rest does not.

    @Test
    void aResourceSharedWithThePublicOpensWithoutAnAccountAndOneNotSharedDoesNot() {
        in(ada, acme)
                .body(Map.of("subject", Map.of("kind", "public"), "level", "view"))
                .put(SHARING + "folder/" + top + "/grants")
                .then()
                .statusCode(200);

        openPublic(acme, "folder", top)
                .then()
                .statusCode(200)
                .body("resource.id", equalTo(top))
                .body("title", equalTo("Title of " + top))
                .body("level", equalTo("view"));
        // Inside it, a type that inherits (MK-136); not a note, whose type does not.
        openPublic(acme, "file", doc).then().statusCode(200).body("level", equalTo("view"));
        openPublic(acme, "note", memo).then().statusCode(404);
        // Not shared, of another organization, unknown: not found alike.
        openPublic(acme, "folder", other).then().statusCode(404);
        openPublic(globex, "folder", top).then().statusCode(404);
        openPublic("no-such-organization", "folder", top).then().statusCode(404);
        openPublic(acme, "nothing", top).then().statusCode(404);
        // A person of another organization does not read it in place of the public.
        in(dan, globex)
                .get("/api/v1/sharing/public/{organization}/{extension}/{type}/{id}", acme, EXTENSION, "folder", top)
                .then()
                .statusCode(404);

        // The code of the extension gets the level of the public for a request that names the
        // organization, and nothing without it or for what is not shared.
        RequestSpecification named = anonymous().header("X-Mosaikit-Public", acme);
        assertThat(level(named, "file", doc)).isEqualTo("view");
        assertThat(level(anonymous().header("X-Mosaikit-Public", acme), "folder", other))
                .isEmpty();
        assertThat(level(anonymous().header("X-Mosaikit-Public", globex), "file", doc))
                .isEmpty();
        assertThat(level(anonymous(), "file", doc)).isEmpty();
        anonymous()
                .header("X-Mosaikit-Public", acme)
                .get(PROBE + "folder/" + other + "/admission")
                .then()
                .body("level", equalTo(""))
                .body("organizationAfter", equalTo(""))
                .body("rowsAfter", equalTo(0));
        // The APIs of extensions: never anonymous for an extension without a public share there.
        anonymous()
                .header("X-Mosaikit-Public", acme)
                .get("/api/v1/ext/test-java/anything")
                .then()
                .statusCode(401);

        // In the trash: nothing, until it is restored (MK-095).
        in(ada, acme).post(TRASH + "folder/" + top).then().statusCode(200);
        openPublic(acme, "folder", top).then().statusCode(404);
        openPublic(acme, "file", doc).then().statusCode(404);
        assertThat(level(anonymous().header("X-Mosaikit-Public", acme), "file", doc))
                .isEmpty();
        in(ada, acme).post(TRASH + "folder/" + top + "/restore").then().statusCode(200);
        openPublic(acme, "file", doc).then().statusCode(200);

        // No longer shared: nothing.
        String grant = in(ada, acme)
                .get(SHARING + "folder/" + top + "/grants")
                .then()
                .statusCode(200)
                .extract()
                .path("find { it.subject.kind == 'public' }.id");
        in(ada, acme).delete("/api/v1/sharing/grants/" + grant).then().statusCode(204);
        openPublic(acme, "folder", top).then().statusCode(404);
        openPublic(acme, "file", doc).then().statusCode(404);
    }

    @Test
    void aLinkOpensInTheEmbeddedViewsOfItsOwnOrganizationOnly() {
        String token = in(ada, acme)
                .body(Map.of(
                        "level",
                        "view",
                        "expires",
                        Instant.now().plus(Duration.ofDays(1)).toString()))
                .post(SHARING + "folder/" + top + "/links")
                .then()
                .statusCode(201)
                .extract()
                .path("token");
        anonymous()
                .body(Map.of("token", token, "organization", acme))
                .post("/api/v1/sharing/links/open")
                .then()
                .statusCode(200)
                .body("resource.id", equalTo(top));
        anonymous()
                .body(Map.of("token", token, "organization", globex))
                .post("/api/v1/sharing/links/open")
                .then()
                .statusCode(404);
        anonymous()
                .body(Map.of("token", token))
                .post("/api/v1/sharing/links/open")
                .then()
                .statusCode(200);
    }
}
