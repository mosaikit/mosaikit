// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The apps of the app bar of an organization, set by its administrators (MK-030). */
@QuarkusTest
@TestProfile(OrganizationAppsTest.TwoApps.class)
@Tag("MK-030")
class OrganizationAppsTest {

    static final Path PLUGINS = Path.of("target", "apps-test", "plugins").toAbsolutePath();
    static final String TODO = "dev.mosaikit.test.todo";
    static final String BOARD = "dev.mosaikit.test.board";
    static final String SLUG = "apps-town";
    static final String PASSWORD = "a long enough password";

    /** Two frontend-only plugins with an app each; the first keeps documents. */
    public static class TwoApps implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            try {
                plugin("todo", TODO, "To do", 10, "data:\n  collections: [items]\n");
                plugin("board", BOARD, "Board", 20, "");
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
            return Map.of("mosaikit.plugins.directory", PLUGINS.toString());
        }

        private static void plugin(String name, String id, String title, int order, String extra) throws IOException {
            Path directory = Files.createDirectories(PLUGINS.resolve(name).resolve("web"));
            Files.writeString(directory.resolve("index.js"), "export default { activate() {} };\n");
            Files.writeString(directory.getParent().resolve("manifest.yaml"), """
                    id: %s
                    version: 1.0.0
                    name: %s (test)
                    kind: [app]
                    platform: '>=0.1 <1'
                    frontend:
                      entry: web/index.js
                    %scontributes:
                      rail.app:
                        - { id: %s, title: %s, route: /app/%s, element: test-%s-app, order: %d }
                    """.formatted(
                            id, title, extra, name, title, name, name, order));
        }
    }

    private String manager;
    private String member;

    @BeforeEach
    void people() {
        asAdmin()
                .body(Map.of("slug", SLUG, "name", "Apps Town", "selfRegistration", true))
                .post("/api/v1/organizations");
        manager = register();
        member = register();
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", SLUG, manager)
                .then()
                .statusCode(200);
        asAdmin()
                .body(List.of())
                .put("/api/v1/organizations/{slug}/apps", SLUG)
                .then()
                .statusCode(200);
    }

    private static String register() {
        String email = unique("apps") + "@example.org";
        anonymous()
                .body(Map.of("organization", SLUG, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static RequestSpecification in(String person) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", SLUG);
    }

    private static Map<String, Object> app(
            String pluginId, String appId, boolean enabled, boolean pinned, List<String> roles) {
        return Map.of("pluginId", pluginId, "appId", appId, "enabled", enabled, "pinned", pinned, "roles", roles);
    }

    @Test
    void showsEveryAppInTheOrderOfThePluginsByDefault() {
        in(manager)
                .get("/api/v1/organizations/{slug}/apps", SLUG)
                .then()
                .statusCode(200)
                .body("appId", contains("todo", "board"))
                .body("title", contains("To do", "Board"))
                .body("enabled", contains(true, true));
        in(member).get("/api/v1/shell/apps").then().statusCode(200).body("appId", contains("todo", "board"));
    }

    @Test
    void turnsAnAppOffWithItsApiAndKeepsTheOrderAndThePinsForEveryone() {
        in(manager)
                .body(List.of(app(BOARD, "board", true, true, List.of()), app(TODO, "todo", false, false, List.of())))
                .put("/api/v1/organizations/{slug}/apps", SLUG)
                .then()
                .statusCode(200)
                .body("appId", contains("board", "todo"));

        in(member)
                .get("/api/v1/shell/apps")
                .then()
                .body("appId", contains("board"))
                .body("[0].pinned", equalTo(true));
        // The documents of the plugin that is off are refused to the organization.
        in(member)
                .get("/api/v1/data/{plugin}/items", TODO)
                .then()
                .statusCode(403)
                .body("detail", equalTo("This app is turned off for your organization."));
        asAdmin().get("/api/v1/audit-events?limit=20").then().body("action", hasItem("organization.apps.changed"));

        // Back to the defaults.
        in(manager)
                .body(List.of())
                .put("/api/v1/organizations/{slug}/apps", SLUG)
                .then()
                .statusCode(200);
        in(member).get("/api/v1/data/{plugin}/items", TODO).then().statusCode(200);
    }

    @Test
    void showsAnAppOnlyToTheRolesChosen() {
        in(manager)
                .body(List.of(
                        app(TODO, "todo", true, false, List.of("organization-admin")),
                        app(BOARD, "board", true, false, List.of())))
                .put("/api/v1/organizations/{slug}/apps", SLUG)
                .then()
                .statusCode(200);

        in(member).get("/api/v1/shell/apps").then().body("appId", contains("board"));
        in(manager).get("/api/v1/shell/apps").then().body("appId", contains("todo", "board"));
    }

    @Test
    void letsOnlyTheAdministratorsOfTheOrganizationChangeItsApps() {
        in(member).get("/api/v1/organizations/{slug}/apps", SLUG).then().statusCode(403);
        in(member)
                .body(List.of())
                .put("/api/v1/organizations/{slug}/apps", SLUG)
                .then()
                .statusCode(403);
        anonymous().get("/api/v1/organizations/{slug}/apps", SLUG).then().statusCode(401);
        in(manager)
                .body(List.of(app("dev.mosaikit.none", "x", true, false, List.of())))
                .put("/api/v1/organizations/{slug}/apps", SLUG)
                .then()
                .statusCode(400);
        in(manager)
                .body(List.of(app(TODO, "todo", true, false, List.of("platform-admin"))))
                .put("/api/v1/organizations/{slug}/apps", SLUG)
                .then()
                .statusCode(400);
    }
}
