// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.config.Config;
import org.eclipse.microprofile.config.ConfigProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** Teams with owners, members and guests, and the documents shared with a team (MK-032). */
@QuarkusTest
@TestProfile(TeamTest.DataPlugin.class)
@Tag("MK-032")
class TeamTest {

    static final Path PLUGINS = Path.of("target", "team-test", "plugins").toAbsolutePath();
    static final String NOTES = "/api/v1/data/dev.mosaikit.test.notes/notes";
    static final String PASSWORD = "a long enough password";

    /** A plugin with only a frontend and the collection "notes". */
    public static class DataPlugin implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            try {
                Path plugin = Files.createDirectories(PLUGINS.resolve("notes").resolve("web"));
                Files.writeString(plugin.resolve("index.js"), "export default { activate() {} };\n");
                Files.writeString(plugin.getParent().resolve("manifest.yaml"), """
                        id: dev.mosaikit.test.notes
                        version: 1.0.0
                        name: Notes (test)
                        kind: [app]
                        platform: '>=0.1 <1'
                        frontend:
                          entry: web/index.js
                        data:
                          collections: [notes]
                        """);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
            return Map.of("mosaikit.plugins.directory", PLUGINS.toString());
        }
    }

    private String town;
    private String owner;
    private String member;
    private String outsider;
    private String guest;

    @BeforeEach
    void people() {
        town = unique("team-town");
        String other = unique("team-other");
        for (String slug : new String[] {town, other}) {
            asAdmin()
                    .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                    .post("/api/v1/organizations")
                    .then()
                    .statusCode(201);
        }
        owner = register(town);
        member = register(town);
        outsider = register(town);
        guest = register(other);
    }

    private static String register(String organization) {
        String email = unique("team") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", email, "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private RequestSpecification in(String person) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", town);
    }

    private String createTeam(String name, String visibility) {
        return in(owner)
                .body(Map.of("name", name, "description", "The people of " + name, "visibility", visibility))
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .body("role", equalTo("owner"))
                .extract()
                .path("id");
    }

    private void put(String team, String person, String role, int status) {
        in(owner)
                .body(Map.of("role", role))
                .put("/api/v1/teams/" + team + "/members/" + person)
                .then()
                .statusCode(status);
    }

    @Test
    void anOwnerManagesThePeopleOfATeamAndEveryChangeIsAudited() {
        String team = createTeam("Roads", "private");
        put(team, member, "member", 200);
        put(team, guest, "guest", 200);
        put(team, member, "owner", 200);
        // A guest is a person of another organization; a member of this one is not a guest.
        put(team, outsider, "guest", 400);
        put(team, "nobody@example.org", "guest", 404);
        put(team, member, "boss", 400);

        in(owner)
                .get("/api/v1/teams/" + team)
                .then()
                .statusCode(200)
                .body("name", equalTo("Roads"))
                .body("members.email", containsInAnyOrder(owner, member, guest))
                .body("members.role", contains("owner", "owner", "guest"));
        // Only owners manage the team.
        in(outsider)
                .body(Map.of("role", "member"))
                .put("/api/v1/teams/" + team + "/members/" + outsider)
                .then()
                .statusCode(404);
        as(guest, PASSWORD)
                .header("X-Mosaikit-Organization", town)
                .body(Map.of("name", "Renamed"))
                .put("/api/v1/teams/" + team)
                .then()
                .statusCode(403);

        in(owner).delete("/api/v1/teams/" + team + "/members/" + member).then().statusCode(204);
        // The last owner cannot leave.
        in(owner).delete("/api/v1/teams/" + team + "/members/" + owner).then().statusCode(409);
        in(owner)
                .body(Map.of("name", "Roads and bridges", "visibility", "public"))
                .put("/api/v1/teams/" + team)
                .then()
                .statusCode(200)
                .body("visibility", equalTo("public"));

        String id = asAdmin().get("/api/v1/organizations/" + town).path("id");
        asAdmin()
                .queryParam("organization", id)
                .get("/api/v1/audit-events")
                .then()
                .statusCode(200)
                .body("action", hasItem("team.created"))
                .body("action", hasItem("team.member.put"))
                .body("action", hasItem("team.member.removed"))
                .body("action", hasItem("team.changed"));
    }

    @Test
    void aGuestSeesOnlyTheirTeamsAndNothingElseOfTheOrganization() {
        String roads = createTeam("Roads", "private");
        createTeam("Parks", "public");
        put(roads, guest, "guest", 200);
        in(owner).body(Map.of("text", "For the whole town")).post(NOTES).then().statusCode(201);

        RequestSpecification asGuest = as(guest, PASSWORD).header("X-Mosaikit-Organization", town);
        asGuest.get("/api/v1/teams").then().statusCode(200).body("name", contains("Roads"));
        asGuest.get(NOTES).then().statusCode(200).body("$", hasSize(0));
        asGuest.body(Map.of("text", "x")).post(NOTES).then().statusCode(403);
        asGuest.body(Map.of("name", "Mine")).post("/api/v1/teams").then().statusCode(403);
        // No API of the organization beyond their teams.
        asGuest.get("/api/v1/shell/plugins").then().statusCode(200);
        asGuest.get("/api/v1/ai/tools").then().statusCode(403);
        asGuest.get("/api/v1/organizations/" + town + "/apps").then().statusCode(403);

        // The members of the organization see the public teams too.
        in(outsider).get("/api/v1/teams").then().body("name", contains("Parks"));
        in(outsider)
                .body(Map.of("role", "member"))
                .put("/api/v1/teams/" + createTeam("Library", "public") + "/members/" + outsider)
                .then()
                .statusCode(200)
                .body("role", equalTo("member"));

        // Out of their last team, the guest is no longer in the organization.
        in(owner).delete("/api/v1/teams/" + roads + "/members/" + guest).then().statusCode(204);
        asGuest.get("/api/v1/teams").then().statusCode(403);
        as(guest, PASSWORD).get("/api/v1/accounts/me").then().body("memberships.slug", not(hasItem(town)));
    }

    @Test
    void aDocumentSharedWithATeamIsReadableByItsMembersOnly() throws SQLException {
        String roads = createTeam("Roads", "private");
        put(roads, member, "member", 200);
        put(roads, guest, "guest", 200);

        String id = as(guest, PASSWORD)
                .header("X-Mosaikit-Organization", town)
                .queryParam("team", roads)
                .body(Map.of("text", "Pothole in Via Roma"))
                .post(NOTES)
                .then()
                .statusCode(201)
                .body("team", equalTo(roads))
                .extract()
                .path("id");

        in(member)
                .queryParam("team", roads)
                .get(NOTES)
                .then()
                .statusCode(200)
                .body("data.text", contains("Pothole in Via Roma"));
        in(member).get(NOTES + "/" + id).then().statusCode(200);
        // Not in the documents of the whole organization, and not for the others.
        in(member).get(NOTES).then().body("$", hasSize(0));
        in(outsider).get(NOTES + "/" + id).then().statusCode(404);
        in(outsider).queryParam("team", roads).get(NOTES).then().statusCode(404);
        in(outsider)
                .queryParam("team", roads)
                .body(Map.of("text", "x"))
                .post(NOTES)
                .then()
                .statusCode(404);
        in(outsider).delete(NOTES + "/" + id).then().statusCode(404);

        // The row-level security decides the same, whatever the query: as the member role, with
        // the settings that the kernel gives the connections of a request.
        assertThat(visibleRows(id, member, false)).isEqualTo(1);
        assertThat(visibleRows(id, outsider, false)).isZero();
        assertThat(visibleRows(id, guest, true)).isEqualTo(1);

        in(owner).delete("/api/v1/teams/" + roads).then().statusCode(204);
        in(member).get(NOTES + "/" + id).then().statusCode(404);
        in(owner).get("/api/v1/teams").then().body("id", not(hasItem(roads)));
        in(owner).get("/api/v1/teams/" + roads).then().statusCode(404);
    }

    private int visibleRows(String document, String person, boolean asGuest) throws SQLException {
        Config config = ConfigProvider.getConfig();
        String organization = asAdmin().get("/api/v1/organizations/" + town).path("id");
        String account = as(person, PASSWORD).get("/api/v1/accounts/me").path("id");
        try (var connection = DriverManager.getConnection(
                        config.getValue("quarkus.datasource.jdbc.url", String.class),
                        config.getValue("quarkus.datasource.username", String.class),
                        config.getValue("quarkus.datasource.password", String.class));
                var role = connection.createStatement();
                var roles = role.executeQuery("select rolname from pg_roles where rolname like 'mk\\_%\\_member'")) {
            roles.next();
            String member = roles.getString(1);
            try (var set = connection.prepareStatement("select set_config('role', ?, false),"
                    + " set_config('mosaikit.organization', ?, false), set_config('mosaikit.account', ?, false),"
                    + " set_config('mosaikit.guest', ?, false)")) {
                set.setString(1, member);
                set.setString(2, organization);
                set.setString(3, account);
                set.setString(4, String.valueOf(asGuest));
                set.execute();
            }
            try (var count =
                    connection.prepareStatement("select count(*) from mk_kernel.plugin_document where id = ?")) {
                count.setObject(1, UUID.fromString(document));
                try (var result = count.executeQuery()) {
                    result.next();
                    return result.getInt(1);
                }
            }
        }
    }

    @Test
    @Tag("MK-034")
    void aGroupOfATeamIsSeenAndReadByItsPeopleOnly() {
        String roads = createTeam("Roads", "public");
        put(roads, member, "member", 200);
        put(roads, guest, "guest", 200);

        String group = in(owner)
                .body(Map.of("name", "Budget", "parent", roads, "visibility", "public"))
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .body("parent", equalTo(roads))
                .body("visibility", equalTo("private"))
                .extract()
                .path("id");
        // A group is not a team of the organization, and only its people see it.
        in(owner).get("/api/v1/teams").then().body("name", not(hasItem("Budget")));
        in(owner).queryParam("parent", roads).get("/api/v1/teams").then().body("name", contains("Budget"));
        in(member).queryParam("parent", roads).get("/api/v1/teams").then().body("$", hasSize(0));
        in(member).get("/api/v1/teams/" + group).then().statusCode(404);

        // Its people come from the team, with the same kind of role.
        put(group, outsider, "member", 400);
        put(group, guest, "member", 400);
        put(group, guest, "guest", 200);
        in(owner)
                .queryParam("team", group)
                .body(Map.of("text", "Figures"))
                .post(NOTES)
                .then()
                .statusCode(201);
        as(guest, PASSWORD)
                .header("X-Mosaikit-Organization", town)
                .queryParam("team", group)
                .get(NOTES)
                .then()
                .body("data.text", contains("Figures"));
        in(member).queryParam("team", group).get(NOTES).then().statusCode(404);

        // Out of the team, out of its groups.
        in(owner).delete("/api/v1/teams/" + roads + "/members/" + guest).then().statusCode(204);
        in(owner).get("/api/v1/teams/" + group).then().body("members.email", contains(owner));
        in(owner).delete("/api/v1/teams/" + roads).then().statusCode(204);
        in(owner).get("/api/v1/teams/" + group).then().statusCode(404);
    }

    @Test
    @Tag("MK-036")
    void aChatIsBetweenItsPeopleOnlyAndOneToOneIsAlwaysTheSame() {
        String chat = in(owner)
                .body(Map.of("kind", "chat", "people", List.of(member)))
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .body("kind", equalTo("chat"))
                .body("visibility", equalTo("private"))
                .body("members.email", containsInAnyOrder(owner, member))
                .extract()
                .path("id");
        // Asked again, by either of them, the chat between two people is the same.
        in(member)
                .body(Map.of("kind", "chat", "people", List.of(owner)))
                .post("/api/v1/teams")
                .then()
                .body("id", equalTo(chat));
        in(member).queryParam("kind", "chat").get("/api/v1/teams").then().body("id", contains(chat));
        // Not a team, and nobody else sees it nor its messages.
        in(owner).get("/api/v1/teams").then().body("id", not(hasItem(chat)));
        in(member)
                .queryParam("team", chat)
                .body(Map.of("text", "Ciao"))
                .post(NOTES)
                .then()
                .statusCode(201);
        in(outsider).get("/api/v1/teams/" + chat).then().statusCode(404);
        in(outsider).queryParam("team", chat).get(NOTES).then().statusCode(404);
        // Only people of the organization, not its guests.
        in(owner)
                .body(Map.of("kind", "chat", "people", List.of(guest)))
                .post("/api/v1/teams")
                .then()
                .statusCode(400);

        // A group chat takes more people; whoever leaves no longer reads it.
        String group = in(owner)
                .body(Map.of("kind", "chat", "name", "Ufficio", "people", List.of(member, outsider)))
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
        in(outsider)
                .delete("/api/v1/teams/" + group + "/members/" + outsider)
                .then()
                .statusCode(204);
        in(outsider).queryParam("kind", "chat").get("/api/v1/teams").then().body("$", hasSize(0));
    }

    @Test
    void refusesTeamsWithoutAName() {
        in(owner).body(Map.of("name", " ")).post("/api/v1/teams").then().statusCode(400);
        createTeam("Roads", "private");
        in(owner).body(Map.of("name", "roads")).post("/api/v1/teams").then().statusCode(409);
        in(owner)
                .body(Map.of("name", "Secret", "visibility", "hidden"))
                .post("/api/v1/teams")
                .then()
                .statusCode(400);
        anonymous().get("/api/v1/teams").then().statusCode(401);
    }
}
