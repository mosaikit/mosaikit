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
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.startsWith;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.dataformat.yaml.YAMLFactory;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ExtensionManifests;
import dev.mosaikit.kernel.api.extension.ManifestParseResult;
import dev.mosaikit.kernel.core.data.RowSecurity;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.sharing.SharingLevels;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
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
 * Sharing of the resources of extensions (MK-055, ADR-0037): the rules of the {@code Sharing} bean,
 * the SQL function that extensions use in their queries, links, the REST API of the sharing dialog
 * and the refusal of an update that removes levels with grants.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-055")
class SharingTest {

    static final String EXTENSION = "dev.mosaikit.test.sharing";
    static final String RESOURCES = """
            resources:
              - type: doc
                title: Document
                levels:
                  - { name: view, title: View }
                  - { name: use, title: Use }
                  - { name: edit, title: Edit, edits: true }
                  - { name: manage, title: Manage, edits: true }
                subjects: [person, group, organization, link, public]
                linkLevel: use
              - type: memo
                title: Memo
                levels: [{ name: view, title: View }, { name: edit, title: Edit, edits: true }]
            """;
    /** The element that shows a doc opened with a link (MK-055). */
    static final String CONTRIBUTES = """
            contributes:
              shared.view:
                - { id: doc-view, type: doc, element: test-doc-view }
            """;

    static final String PASSWORD = "a long enough password";
    static final String REGISTRY = "/api/v1/test/resources/" + EXTENSION + "/";
    static final String PROBE = "/api/v1/test/sharing/" + EXTENSION + "/";
    static final String API = "/api/v1/sharing/resources/" + EXTENSION + "/";
    static final List<String> DOC_LEVELS = List.of("view", "use", "edit", "manage");

    @Inject
    AgroalDataSource dataSource;

    @Inject
    SharingLevels levels;

    @Inject
    ExtensionRegistry extensions;

    @Inject
    RowSecurity rowSecurity;

    private String acme;
    private String globex;
    private String ada;
    private String bea;
    private String cleo;
    private String manager;
    private String dan;

    @BeforeEach
    void people() {
        acme = organization();
        globex = organization();
        ada = register(acme);
        bea = register(acme);
        cleo = register(acme);
        manager = register(acme);
        dan = register(globex);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", acme, manager)
                .then()
                .statusCode(200);
    }

    // --- Helpers -------------------------------------------------------------------------------

    private static String organization() {
        String slug = unique("sharing");
        asAdmin()
                .body(Map.of("slug", slug, "name", "Org " + slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("sharing") + "@example.org";
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

    private static String id(String person, String organization) {
        return in(person, organization).get("/api/v1/accounts/me").path("id");
    }

    private static void resource(String owner, String organization, String type, String id) {
        in(owner, organization)
                .body(Map.of("title", "Title of " + id, "link", "/app/sharing/" + id))
                .put(REGISTRY + type + "/" + id)
                .then()
                .statusCode(200);
    }

    private String team(String owner, String organization, String... members) {
        return team(owner, organization, List.of(members), List.of());
    }

    private String team(String owner, String organization, List<String> members, List<String> guests) {
        String team = in(owner, organization)
                .body(Map.of("name", unique("team"), "description", "A team", "visibility", "private"))
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
        for (String member : members) {
            in(owner, organization)
                    .body(Map.of("role", guests.contains(member) ? "guest" : "member"))
                    .put("/api/v1/teams/" + team + "/members/" + member)
                    .then()
                    .statusCode(200);
        }
        return team;
    }

    /** Shares through the REST API of the dialog; answers the status. */
    private static io.restassured.response.Response share(
            String person, String organization, String type, String id, String kind, String subject, String level) {
        Map<String, Object> who = new HashMap<>();
        who.put("kind", kind);
        if (subject != null) {
            who.put("id", subject);
        }
        return in(person, organization)
                .body(Map.of("subject", who, "level", level))
                .put(API + type + "/" + id + "/grants");
    }

    private static String level(RequestSpecification request, String type, String id) {
        return request.get(PROBE + type + "/" + id + "/level")
                .then()
                .statusCode(200)
                .extract()
                .path("level");
    }

    private static String level(String person, String organization, String type, String id) {
        return level(in(person, organization), type, id);
    }

    private static io.restassured.response.Response link(
            String person,
            String organization,
            String type,
            String id,
            String level,
            Instant expires,
            String password) {
        Map<String, Object> body = new HashMap<>(Map.of("level", level, "expires", expires.toString()));
        if (password != null) {
            body.put("password", password);
        }
        return in(person, organization).body(body).post(API + type + "/" + id + "/links");
    }

    private static io.restassured.response.Response open(String token, String password) {
        Map<String, Object> body = new HashMap<>(Map.of("token", token));
        if (password != null) {
            body.put("password", password);
        }
        return anonymous().body(body).post("/api/v1/sharing/links/open");
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
                .path("findAll { it.action.startsWith('sharing.') }");
    }

    private void execute(String sql) throws SQLException {
        try (var connection = dataSource.getConnection();
                var statement = connection.createStatement()) {
            // As the owner of the tables, whatever the request context of the test thread.
            statement.execute("set role none");
            statement.executeUpdate(sql);
        }
    }

    // --- Rules of the Sharing bean ------------------------------------------------------------

    @Test
    void deniesByDefaultAndGivesEveryLevelToTheOwnerAndTheAdministratorsOnly() {
        resource(ada, acme, "doc", "d1");

        assertThat(level(ada, acme, "doc", "d1")).isEqualTo("manage");
        assertThat(level(manager, acme, "doc", "d1")).isEqualTo("manage");
        assertThat(level(bea, acme, "doc", "d1")).isEmpty();
        // The Java answer for a person agrees with the answer for their request.
        assertThat(level(in(ada, acme).queryParam("person", id(bea, acme)), "doc", "d1"))
                .isEmpty();
        assertThat(level(in(bea, acme).queryParam("person", id(manager, acme)), "doc", "d1"))
                .isEqualTo("manage");
        in(bea, acme)
                .get(PROBE + "doc/d1/allows/view")
                .then()
                .body("java", equalTo(false))
                .body("sql", equalTo(false));
        in(manager, acme)
                .get(PROBE + "doc/d1/allows/manage")
                .then()
                .body("java", equalTo(true))
                .body("sql", equalTo(true));
        // require answers 404 to a person without a level, so that the resource is not revealed.
        in(bea, acme).get(PROBE + "doc/d1/require/view").then().statusCode(404);
        // Another organization does not see it at all.
        assertThat(level(dan, globex, "doc", "d1")).isEmpty();
    }

    @Test
    void aResourceSharedWithAGroupIsReadByItsMembersOnly() {
        resource(ada, acme, "doc", "d1");
        String team = team(ada, acme, bea);

        share(ada, acme, "doc", "d1", "group", team, "view").then().statusCode(200);

        assertThat(level(bea, acme, "doc", "d1")).isEqualTo("view");
        assertThat(level(cleo, acme, "doc", "d1")).isEmpty();
        in(bea, acme)
                .get(PROBE + "doc/d1/allows/view")
                .then()
                .body("java", equalTo(true))
                .body("sql", equalTo(true));
        in(bea, acme)
                .get(PROBE + "doc/d1/allows/use")
                .then()
                .body("java", equalTo(false))
                .body("sql", equalTo(false));
        in(cleo, acme)
                .get(PROBE + "doc/d1/allows/view")
                .then()
                .body("java", equalTo(false))
                .body("sql", equalTo(false));
        in(bea, acme).get(PROBE + "doc/d1/require/view").then().statusCode(204);
        in(bea, acme).get(PROBE + "doc/d1/require/edit").then().statusCode(403);
        in(cleo, acme).get(PROBE + "doc/d1/require/view").then().statusCode(404);

        // As they are at every check: who leaves the team loses the level.
        in(ada, acme).delete("/api/v1/teams/" + team + "/members/" + bea).then().statusCode(204);
        assertThat(level(bea, acme, "doc", "d1")).isEmpty();
    }

    @Test
    void grantsOnlyAddAndTheHighestLevelWins() {
        resource(ada, acme, "doc", "d1");
        String team = team(ada, acme, bea);
        share(ada, acme, "doc", "d1", "organization", null, "view").then().statusCode(200);
        share(ada, acme, "doc", "d1", "group", team, "use").then().statusCode(200);
        share(ada, acme, "doc", "d1", "person", id(bea, acme), "edit").then().statusCode(200);

        assertThat(level(bea, acme, "doc", "d1")).isEqualTo("edit");
        assertThat(level(cleo, acme, "doc", "d1")).isEqualTo("view");
        assertThat(level(dan, globex, "doc", "d1")).isEmpty();
    }

    @Test
    void grantingAgainReplacesTheLevelAlsoLoweringItAndIsAudited() {
        resource(ada, acme, "doc", "d1");
        String beaId = id(bea, acme);

        String first = share(ada, acme, "doc", "d1", "person", beaId, "edit")
                .then()
                .statusCode(200)
                .body("subject.kind", equalTo("person"))
                .body("subject.email", equalTo(bea))
                .extract()
                .path("id");
        String second = share(ada, acme, "doc", "d1", "person", beaId, "view")
                .then()
                .statusCode(200)
                .body("level", equalTo("view"))
                .extract()
                .path("id");

        assertThat(second).isEqualTo(first);
        assertThat(level(bea, acme, "doc", "d1")).isEqualTo("view");
        in(ada, acme).get(API + "doc/d1/grants").then().statusCode(200).body("$", hasSize(1));
        List<Map<String, Object>> events = audit(acme);
        assertThat(events)
                .filteredOn(event -> "sharing.granted".equals(event.get("action")))
                .extracting(event -> (String) event.get("detail"))
                .anySatisfy(detail ->
                        assertThat(detail).contains("\"level\":\"view\"").contains("\"previousLevel\":\"edit\""));
    }

    @Test
    void linksAndThePublicGetLittle() {
        resource(ada, acme, "doc", "d1");
        resource(ada, acme, "memo", "m1");
        Instant tomorrow = Instant.now().plus(Duration.ofDays(1));

        // The public: the lowest level only.
        share(ada, acme, "doc", "d1", "public", null, "use").then().statusCode(400);
        share(ada, acme, "doc", "d1", "public", null, "view").then().statusCode(200);
        // A link: at most the link level of the type, never a level that edits.
        link(ada, acme, "doc", "d1", "edit", tomorrow, null).then().statusCode(400);
        link(ada, acme, "doc", "d1", "use", tomorrow, null).then().statusCode(201);
        // A type that does not accept links nor the public.
        link(ada, acme, "memo", "m1", "view", tomorrow, null).then().statusCode(400);
        share(ada, acme, "memo", "m1", "public", null, "view").then().statusCode(400);
        // A link always expires, within the longest validity of the installation (30 days).
        link(ada, acme, "doc", "d1", "view", Instant.now().minusSeconds(60), null)
                .then()
                .statusCode(400);
        link(ada, acme, "doc", "d1", "view", Instant.now().plus(Duration.ofDays(31)), null)
                .then()
                .statusCode(400)
                .body("detail", containsString("mosaikit.sharing.link-max-validity"));
        link(ada, acme, "doc", "d1", "view", Instant.now().plus(Duration.ofDays(29)), null)
                .then()
                .statusCode(201);
        // Links are never granted as subjects.
        share(ada, acme, "doc", "d1", "link", null, "view").then().statusCode(400);

        // The public gives the lowest level to every member, and is in mk_kernel.allows() too.
        assertThat(level(cleo, acme, "doc", "d1")).isEqualTo("view");
        in(cleo, acme)
                .get(PROBE + "doc/d1/allows/view")
                .then()
                .body("java", equalTo(true))
                .body("sql", equalTo(true));
    }

    @Test
    void theOwnerTheHoldersOfTheHighestLevelAndTheAdministratorsShare() {
        resource(ada, acme, "doc", "d1");
        String beaId = id(bea, acme);
        String cleoId = id(cleo, acme);

        // A person with a level lower than the highest may not share: 403; without a level: 404.
        share(ada, acme, "doc", "d1", "person", beaId, "edit").then().statusCode(200);
        share(bea, acme, "doc", "d1", "person", cleoId, "view").then().statusCode(403);
        share(cleo, acme, "doc", "d1", "person", beaId, "view").then().statusCode(404);
        in(bea, acme).get(API + "doc/d1/grants").then().statusCode(403);
        in(cleo, acme).get(API + "doc/d1/grants").then().statusCode(404);
        in(bea, acme)
                .get(API + "doc/d1")
                .then()
                .statusCode(200)
                .body("level", equalTo("edit"))
                .body("canShare", equalTo(false));

        // With the highest level, they share.
        share(ada, acme, "doc", "d1", "person", beaId, "manage").then().statusCode(200);
        in(bea, acme).get(API + "doc/d1").then().body("canShare", equalTo(true));
        share(bea, acme, "doc", "d1", "person", cleoId, "view").then().statusCode(200);
        // So do the administrators of the organization, on a resource they hold no grant on.
        share(manager, acme, "doc", "d1", "person", cleoId, "use").then().statusCode(200);
        assertThat(level(cleo, acme, "doc", "d1")).isEqualTo("use");

        // People and groups of another organization are refused.
        share(ada, acme, "doc", "d1", "person", id(dan, globex), "view").then().statusCode(400);
        String foreignTeam = team(dan, globex);
        share(ada, acme, "doc", "d1", "group", foreignTeam, "view").then().statusCode(400);
        // An undeclared level is refused.
        share(ada, acme, "doc", "d1", "person", cleoId, "own").then().statusCode(400);
        anonymous().get(API + "doc/d1/grants").then().statusCode(401);
    }

    @Test
    void theDialogListsTheGrantsWithTheNamesOfTheirSubjects() {
        resource(ada, acme, "doc", "d1");
        String team = team(ada, acme, bea);
        share(ada, acme, "doc", "d1", "group", team, "use").then().statusCode(200);
        share(ada, acme, "doc", "d1", "organization", null, "view").then().statusCode(200);
        link(ada, acme, "doc", "d1", "view", Instant.now().plus(Duration.ofDays(2)), "secret words")
                .then()
                .statusCode(201);

        JsonPath grants = in(ada, acme)
                .get(API + "doc/d1/grants")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath();
        assertThat(grants.getList("subject.kind")).containsExactly("group", "organization", "link");
        assertThat(grants.getString("find { it.subject.kind == 'group' }.subject.name"))
                .startsWith("team-");
        assertThat(grants.getString("find { it.subject.kind == 'organization' }.subject.name"))
                .isEqualTo("Org " + acme);
        assertThat(grants.getBoolean("find { it.subject.kind == 'link' }.password"))
                .isTrue();
        assertThat(grants.getString("find { it.subject.kind == 'link' }.expires"))
                .isNotNull();
        assertThat(grants.getString("[0].grantedByName")).isEqualTo("P " + ada);

        in(ada, acme)
                .get(API + "doc/d1")
                .then()
                .statusCode(200)
                .body("title", equalTo("Title of d1"))
                .body("level", equalTo("manage"))
                .body("canShare", equalTo(true))
                .body("levels.name", equalTo(DOC_LEVELS))
                .body("linkLevel", equalTo("use"))
                .body("subjects", hasItem("public"));
        in(cleo, acme).get(API + "doc/d1").then().statusCode(200).body("level", equalTo("view"));
        in(dan, globex).get(API + "doc/d1").then().statusCode(404);
    }

    // --- Links ---------------------------------------------------------------------------------

    @Test
    void aLinkOpensTheResourceWithoutAnAccountUntilItIsRevokedOrExpires() throws SQLException {
        resource(ada, acme, "doc", "d1");
        JsonPath made = link(ada, acme, "doc", "d1", "use", Instant.now().plus(Duration.ofDays(1)), null)
                .then()
                .statusCode(201)
                .body("address", startsWith("/shared/"))
                .body("grant.subject.kind", equalTo("link"))
                .extract()
                .jsonPath();
        String token = made.getString("token");
        assertThat(made.getString("address")).endsWith(token);

        open(token, null)
                .then()
                .statusCode(200)
                .body("resource.extension", equalTo(EXTENSION))
                .body("resource.id", equalTo("d1"))
                .body("level", equalTo("use"))
                .body("link", equalTo("/app/sharing/d1"));
        // A request opened with the link gets its level from the Java API, also without an account.
        assertThat(level(anonymous().header("X-Mosaikit-Link", token), "doc", "d1"))
                .isEqualTo("use");
        assertThat(level(anonymous(), "doc", "d1")).isEmpty();
        anonymous()
                .header("X-Mosaikit-Link", token)
                .get(PROBE + "doc/visible/view")
                .then()
                .body("java", equalTo(List.of("d1")));
        // Only the digest of the secret is kept.
        assertThat(rows("select count(*) from mk_kernel.resource_grant where token_digest = '" + token + "'"))
                .isZero();
        assertThat(rows("select count(*) from mk_kernel.resource_grant where token_digest = encode(sha256('" + token
                        + "'::bytea), 'hex')"))
                .isOne();

        // Revoked: not found.
        in(ada, acme)
                .delete("/api/v1/sharing/grants/" + made.getString("grant.id"))
                .then()
                .statusCode(204);
        open(token, null).then().statusCode(404);
        assertThat(level(anonymous().header("X-Mosaikit-Link", token), "doc", "d1"))
                .isEmpty();
        in(ada, acme).get(API + "doc/d1/grants").then().body("$", hasSize(0));

        // Expired: not found.
        String other = link(ada, acme, "doc", "d1", "view", Instant.now().plus(Duration.ofDays(1)), null)
                .then()
                .statusCode(201)
                .extract()
                .path("token");
        open(other, null).then().statusCode(200);
        execute("update mk_kernel.resource_grant set expires_at = now() - interval '1 minute'"
                + " where subject_kind = 'link' and revoked_at is null and resource_id in"
                + " (select r.id from mk_kernel.resource r join mk_kernel.organization o on o.id = r.organization_id"
                + " where r.extension_id = '" + EXTENSION + "' and r.ref_id = 'd1' and o.slug = '" + acme + "')");
        open(other, null).then().statusCode(404);
        open("no-such-link", null).then().statusCode(404);

        // Every refused use is in the audit log; a use that works, the first time of each hour for each
        // link (#96): the link above was used five times, the other one once.
        List<Map<String, Object>> uses = audit(acme).stream()
                .filter(event -> "sharing.link.used".equals(event.get("action")))
                .toList();
        assertThat(uses).extracting(event -> event.get("outcome")).contains("SUCCEEDED", "FAILED");
        assertThat(uses).extracting(event -> event.get("actor")).containsOnly("anonymous");
        String grant = made.getString("grant.id");
        assertThat(uses)
                .filteredOn(event -> "SUCCEEDED".equals(event.get("outcome")))
                .filteredOn(event -> String.valueOf(event.get("detail")).contains(grant))
                .hasSize(1);
        assertThat(uses)
                .filteredOn(event -> "SUCCEEDED".equals(event.get("outcome")))
                .hasSize(2);
        assertThat(uses)
                .filteredOn(event -> "FAILED".equals(event.get("outcome")))
                .extracting(event -> String.valueOf(event.get("detail")))
                .anySatisfy(detail -> assertThat(detail).contains("revoked"))
                .anySatisfy(detail -> assertThat(detail).contains("expired"));
        assertThat(audit(acme))
                .extracting(event -> event.get("action"))
                .contains("sharing.link.created", "sharing.link.revoked");
    }

    @Test
    void aLinkWithAPasswordOpensOnlyWithIt() {
        resource(ada, acme, "doc", "d1");
        String token = link(ada, acme, "doc", "d1", "view", Instant.now().plus(Duration.ofDays(1)), "open sesame")
                .then()
                .statusCode(201)
                .extract()
                .path("token");

        open(token, null).then().statusCode(403).body("detail", containsString("asks for a password"));
        open(token, "wrong").then().statusCode(403).body("detail", containsString("wrong"));
        open(token, "open sesame").then().statusCode(200).body("level", equalTo("view"));
        assertThat(level(anonymous().header("X-Mosaikit-Link", token), "doc", "d1"))
                .isEmpty();
        assertThat(level(
                        anonymous().header("X-Mosaikit-Link", token).header("X-Mosaikit-Link-Password", "open sesame"),
                        "doc",
                        "d1"))
                .isEqualTo("view");
        // Each refusal is audited, however often it comes; the uses that work, once.
        assertThat(audit(acme))
                .filteredOn(event -> "sharing.link.used".equals(event.get("action")))
                .extracting(event -> event.get("outcome"))
                .containsExactlyInAnyOrder("DENIED", "DENIED", "DENIED", "SUCCEEDED");
    }

    // --- The SQL function --------------------------------------------------------------------

    @Test
    void theSqlFunctionAgreesWithTheJavaAnswersOnMixedData() throws SQLException {
        String guest = register(globex);
        for (String id : List.of("a", "b", "c", "d", "e", "f")) {
            resource(ada, acme, "doc", id);
        }
        resource(bea, acme, "doc", "g");
        String team = team(ada, acme, List.of(bea, guest), List.of(guest));
        share(ada, acme, "doc", "a", "group", team, "edit").then().statusCode(200);
        share(ada, acme, "doc", "b", "organization", null, "use").then().statusCode(200);
        share(ada, acme, "doc", "c", "person", id(cleo, acme), "manage").then().statusCode(200);
        share(ada, acme, "doc", "d", "public", null, "view").then().statusCode(200);
        share(ada, acme, "doc", "e", "person", id(bea, acme), "view").then().statusCode(200);
        share(ada, acme, "doc", "e", "group", team, "use").then().statusCode(200);
        link(ada, acme, "doc", "f", "use", Instant.now().plus(Duration.ofDays(1)), null)
                .then()
                .statusCode(201);

        for (String person : List.of(ada, bea, cleo, manager)) {
            for (String level : DOC_LEVELS) {
                JsonPath answer = in(person, acme)
                        .get(PROBE + "doc/visible/" + level)
                        .then()
                        .statusCode(200)
                        .extract()
                        .jsonPath();
                assertThat(answer.getList("sql", String.class))
                        .as("%s at %s", person, level)
                        .containsExactlyInAnyOrderElementsOf(answer.getList("java", String.class));
            }
        }
        // A guest reaches no extension backend over HTTP (MK-032): the function runs as their request would.
        String organizationId =
                asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");
        String guestId = id(guest, acme);
        for (String level : DOC_LEVELS) {
            assertThat(sqlAs(organizationId, guestId, true, level))
                    .as("guest at %s", level)
                    .containsExactlyInAnyOrderElementsOf(in(ada, acme)
                            .queryParam("person", guestId)
                            .get(PROBE + "doc/visible/" + level)
                            .jsonPath()
                            .getList("java", String.class));
        }
        // A few answers, checked by hand.
        assertThat(in(bea, acme).get(PROBE + "doc/visible/view").jsonPath().getList("java", String.class))
                .containsExactlyInAnyOrder("a", "b", "d", "e", "g");
        assertThat(sqlAs(organizationId, guestId, true, "view")).containsExactlyInAnyOrder("a", "d", "e");
        // The guest opens in the sharing dialog what their team has, not what the organization has.
        in(guest, acme).get(API + "doc/a").then().statusCode(200).body("level", equalTo("edit"));
        in(guest, acme).get(API + "doc/b").then().statusCode(404);
        assertThat(in(cleo, acme).get(PROBE + "doc/visible/edit").jsonPath().getList("java", String.class))
                .containsExactlyInAnyOrder("c");
        assertThat(in(manager, acme)
                        .get(PROBE + "doc/visible/manage")
                        .jsonPath()
                        .getList("java", String.class))
                .containsExactlyInAnyOrder("a", "b", "c", "d", "e", "f", "g");
        // The answer for a person agrees with the answer for their request.
        assertThat(in(ada, acme)
                        .queryParam("person", id(bea, acme))
                        .get(PROBE + "doc/visible/view")
                        .jsonPath()
                        .getList("java", String.class))
                .containsExactlyInAnyOrder("a", "b", "d", "e", "g");
    }

    /** The documents that mk_kernel.allows() lets through for the request of a person, set up as the kernel does. */
    private List<String> sqlAs(String organization, String account, boolean guest, String level) throws SQLException {
        try (var connection = dataSource.getConnection()) {
            try (var setup = connection.prepareStatement(
                    "select set_config('role', ?, false),"
                            + " set_config('mosaikit.organization', ?, false), set_config('mosaikit.account', ?, false),"
                            + " set_config('mosaikit.guest', ?, false), set_config('mosaikit.administrator', 'false', false)")) {
                setup.setString(1, rowSecurity.role().orElseThrow());
                setup.setString(2, organization);
                setup.setString(3, account);
                setup.setString(4, String.valueOf(guest));
                setup.execute();
            }
            List<String> ids = new java.util.ArrayList<>();
            try (var query = connection.prepareStatement("select r.ref_id from mk_kernel.resource r"
                    + " where r.extension_id = ? and r.type = 'doc'"
                    + " and mk_kernel.allows(r.extension_id, r.type, r.ref_id, ?)")) {
                query.setString(1, EXTENSION);
                query.setString(2, level);
                try (var result = query.executeQuery()) {
                    while (result.next()) {
                        ids.add(result.getString(1));
                    }
                }
            } finally {
                try (var reset = connection.createStatement()) {
                    reset.execute(
                            "select set_config('role', 'none', false), set_config('mosaikit.organization', '', false),"
                                    + " set_config('mosaikit.account', '', false), set_config('mosaikit.guest', '', false)");
                }
            }
            return ids;
        }
    }
    // --- Organizations ------------------------------------------------------------------------

    @Test
    void anotherOrganizationNeverSeesNorRevokesTheGrants() {
        resource(ada, acme, "doc", "d1");
        String grant = share(ada, acme, "doc", "d1", "organization", null, "view")
                .then()
                .statusCode(200)
                .extract()
                .path("id");
        resource(dan, globex, "doc", "d1");

        // The same reference in another organization is another resource, with no grant.
        in(dan, globex).get(PROBE + "doc/d1/grants").then().statusCode(200).body("$", hasSize(0));
        assertThat(level(dan, globex, "doc", "d1")).isEqualTo("manage");
        in(dan, globex).delete("/api/v1/sharing/grants/" + grant).then().statusCode(204);
        in(ada, acme).get(PROBE + "doc/d1/grants").then().body("id", hasItem(grant));
        in(dan, globex)
                .get(PROBE + "doc/visible/view")
                .then()
                .body("java", equalTo(List.of("d1")))
                .body("sql", equalTo(List.of("d1")));
        assertThat(in(cleo, acme).get(PROBE + "doc/visible/view").jsonPath().getList("sql", String.class))
                .containsExactly("d1");
    }

    // --- Updates of extensions ---------------------------------------------------------------

    @Test
    void anUpdateThatRemovesALevelOrATypeWithGrantsIsRefusedWithTheirList() {
        resource(ada, acme, "memo", "m1");
        share(ada, acme, "memo", "m1", "person", id(bea, acme), "edit").then().statusCode(200);
        ExtensionManifest current = extensions
                .findActive(EXTENSION)
                .flatMap(InstalledExtension::manifest)
                .orElseThrow();
        String withoutEdit = RESOURCES.replace(
                "levels: [{ name: view, title: View }, { name: edit, title: Edit, edits: true }]",
                "levels: [{ name: view, title: View }]");
        String withoutMemo = RESOURCES.substring(0, RESOURCES.indexOf("  - type: memo"));

        // Without the level "edit" of memo, or without memo: refused, with the grant named.
        assertThatThrownBy(() -> levels.refuseRemovals(current, manifest(withoutEdit)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("the levels edit of memo")
                .hasMessageContaining(acme + ": memo m1 (Title of m1) shared with person " + bea + " at edit");
        assertThatThrownBy(() -> levels.refuseRemovals(current, manifest(withoutMemo)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("the resource type memo")
                .hasMessageContaining(acme + ": memo m1");
        // An update that removes nothing passes.
        levels.refuseRemovals(current, manifest(RESOURCES));

        // Once revoked, the level and the type can go.
        String grant =
                in(ada, acme).get(API + "memo/m1/grants").then().extract().path("[0].id");
        in(ada, acme).delete("/api/v1/sharing/grants/" + grant).then().statusCode(204);
        levels.refuseRemovals(current, manifest(withoutEdit));
        levels.refuseRemovals(current, manifest(withoutMemo));
    }

    private static ExtensionManifest manifest(String resources) {
        Map<String, Object> tree;
        try {
            @SuppressWarnings("unchecked")
            Map<String, Object> read = new ObjectMapper(new YAMLFactory()).readValue(resources, Map.class);
            tree = new HashMap<>(read);
        } catch (java.io.IOException e) {
            throw new java.io.UncheckedIOException(e);
        }
        tree.putAll(Map.of(
                "id",
                EXTENSION,
                "version",
                "1.1.0",
                "name",
                "Sharing",
                "kind",
                List.of("app"),
                "platform",
                ">=0.1 <1"));
        ManifestParseResult result = ExtensionManifests.parse(tree);
        assertThat(result).isInstanceOf(ManifestParseResult.Valid.class);
        return ((ManifestParseResult.Valid) result).manifest();
    }

    // --- The dialog of the shell and the answers to the extension (acceptance 1 and 4) ------------

    @Test
    void theExtensionAndTheDialogGiveEveryoneTheSameLevel() {
        resource(ada, acme, "doc", "d1");
        String team = team(ada, acme, bea);
        share(ada, acme, "doc", "d1", "group", team, "use").then().statusCode(200);
        in(ada, acme)
                .body(Map.of("subject", Map.of("kind", "person", "email", cleo), "level", "edit"))
                .put(API + "doc/d1/grants")
                .then()
                .statusCode(200)
                .body("subject.email", equalTo(cleo));

        for (String person : List.of(ada, bea, cleo, manager)) {
            String java = level(person, acme, "doc", "d1");
            String dialog = in(person, acme)
                    .get(API + "doc/d1")
                    .then()
                    .statusCode(200)
                    .extract()
                    .path("level");
            assertThat(dialog).as(person).isEqualTo(java);
            // The answer for a person, asked by another one, is the same as well.
            assertThat(level(in(manager, acme).queryParam("person", id(person, acme)), "doc", "d1"))
                    .as(person)
                    .isEqualTo(java);
        }
        assertThat(level(bea, acme, "doc", "d1")).isEqualTo("use");
        assertThat(level(cleo, acme, "doc", "d1")).isEqualTo("edit");
        // Without a level: nothing for the extension, not found for the dialog.
        String outsider = register(acme);
        assertThat(level(outsider, acme, "doc", "d1")).isEmpty();
        in(outsider, acme).get(API + "doc/d1").then().statusCode(404);
        // A link: the level that opening it shows is the level the extension gets.
        String token = link(ada, acme, "doc", "d1", "use", Instant.now().plus(Duration.ofDays(1)), null)
                .then()
                .statusCode(201)
                .extract()
                .path("token");
        String opened = open(token, null).then().statusCode(200).extract().path("level");
        assertThat(level(anonymous().header("X-Mosaikit-Link", token), "doc", "d1"))
                .isEqualTo(opened);
    }

    @Test
    void theDialogNamesTheOwnerFindsPeopleByEmailAndOffersTheViewOfLinks() {
        resource(ada, acme, "doc", "d1");
        in(ada, acme).get(API + "doc/d1").then().statusCode(200).body("ownerName", equalTo("P " + ada));

        Map<String, Object> elsewhere = Map.of("subject", Map.of("kind", "person", "email", dan), "level", "view");
        in(ada, acme).body(elsewhere).put(API + "doc/d1/grants").then().statusCode(400);
        Map<String, Object> nobody =
                Map.of("subject", Map.of("kind", "person", "email", "nobody@example.org"), "level", "view");
        in(ada, acme)
                .body(nobody)
                .put(API + "doc/d1/grants")
                .then()
                .statusCode(400)
                .body("detail", containsString("not of the organization"));
        Map<String, Object> noOne = Map.of("subject", Map.of("kind", "person"), "level", "view");
        in(ada, acme).body(noOne).put(API + "doc/d1/grants").then().statusCode(400);

        // Opening a link names the element of the extension that shows the resource.
        String token = link(ada, acme, "doc", "d1", "view", Instant.now().plus(Duration.ofDays(1)), null)
                .then()
                .statusCode(201)
                .extract()
                .path("token");
        open(token, null)
                .then()
                .statusCode(200)
                .body("view.extension", equalTo(EXTENSION))
                .body("view.element", equalTo("test-doc-view"))
                .body("view.entry", startsWith("/api/v1/extension-assets/" + EXTENSION + "/"));
    }

    // --- Requests opened with a link (acceptance 3) ---------------------------------------------

    @Test
    void aRequestOpenedWithALinkActsOnTheOrganizationOfItsResourceOnlyOnceSharingAnswered() {
        resource(ada, acme, "doc", "d1");
        resource(ada, acme, "doc", "d2");
        String acmeId = asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");
        String globexId = asAdmin().get("/api/v1/organizations/{slug}", globex).path("id");
        JsonPath made = link(ada, acme, "doc", "d1", "view", Instant.now().plus(Duration.ofDays(1)), null)
                .then()
                .statusCode(201)
                .extract()
                .jsonPath();
        String token = made.getString("token");

        // Before asking Sharing, no organization and no row; after, the organization of the resource,
        // on the connection held across too.
        anonymous()
                .header("X-Mosaikit-Link", token)
                .get(PROBE + "doc/d1/admission")
                .then()
                .statusCode(200)
                .body("organizationBefore", equalTo(""))
                .body("rowsBefore", equalTo(0))
                .body("level", equalTo("view"))
                .body("organizationAfter", equalTo(acmeId))
                .body("rowsAfter", equalTo(2));
        // Asking about another resource admits nothing, and neither does not asking.
        anonymous()
                .header("X-Mosaikit-Link", token)
                .get(PROBE + "doc/d2/admission")
                .then()
                .body("level", equalTo(""))
                .body("organizationAfter", equalTo(""))
                .body("rowsAfter", equalTo(0));
        anonymous()
                .header("X-Mosaikit-Link", token)
                .get(PROBE + "doc/d1/no-admission")
                .then()
                .body("organization", equalTo(""))
                .body("rows", equalTo(0));
        // A person keeps their own organization, where the link gives nothing.
        in(dan, globex)
                .header("X-Mosaikit-Link", token)
                .get(PROBE + "doc/d1/admission")
                .then()
                .body("level", equalTo(""))
                .body("organizationAfter", equalTo(globexId));

        // The APIs of extensions: never anonymous, unless a working link opens a resource of the
        // extension that provides the API; no extension of the tests provides an active one.
        anonymous().get("/api/v1/ext/test-java/anything").then().statusCode(401);
        anonymous()
                .header("X-Mosaikit-Link", token)
                .get("/api/v1/ext/test-java/anything")
                .then()
                .statusCode(401);

        // Revoked: nothing again.
        in(ada, acme)
                .delete("/api/v1/sharing/grants/" + made.getString("grant.id"))
                .then()
                .statusCode(204);
        anonymous()
                .header("X-Mosaikit-Link", token)
                .get(PROBE + "doc/d1/admission")
                .then()
                .body("level", equalTo(""))
                .body("organizationAfter", equalTo(""))
                .body("rowsAfter", equalTo(0));
    }

    private long rows(String sql) throws SQLException {
        try (var connection = dataSource.getConnection();
                var statement = connection.createStatement()) {
            statement.execute("set role none");
            try (var result = statement.executeQuery(sql)) {
                result.next();
                return result.getLong(1);
            }
        }
    }
}
