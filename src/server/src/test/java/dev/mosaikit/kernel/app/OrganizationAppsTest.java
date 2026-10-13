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
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The apps of the app bar of an organization, set by its administrators (MK-030). */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-030")
class OrganizationAppsTest {

    static final Path EXTENSIONS = TestExtensions.EXTENSIONS;
    static final String TODO = "dev.mosaikit.test.todo";
    static final String BOARD = "dev.mosaikit.test.board";
    static final String SLUG = "apps-town";
    static final String PASSWORD = "a long enough password";

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
            String extensionId, String appId, boolean enabled, boolean pinned, List<String> roles) {
        return Map.of("extensionId", extensionId, "appId", appId, "enabled", enabled, "pinned", pinned, "roles", roles);
    }

    @Test
    void showsEveryAppInTheOrderOfTheExtensionsByDefault() {
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
        // The documents of the extension that is off are refused to the organization.
        in(member)
                .get("/api/v1/data/{extension}/items", TODO)
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
        in(member).get("/api/v1/data/{extension}/items", TODO).then().statusCode(200);
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
