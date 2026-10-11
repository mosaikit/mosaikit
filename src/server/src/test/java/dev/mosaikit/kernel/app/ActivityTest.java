// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;

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

/** The activity feed and the notifications of plugins (MK-038). */
@QuarkusTest
@TestProfile(ActivityTest.NotesPlugin.class)
@Tag("MK-038")
class ActivityTest {

    static final Path PLUGINS = Path.of("target", "activity-test", "plugins").toAbsolutePath();
    static final String PLUGIN = "dev.mosaikit.test.notify";
    static final String SLUG = "activity-town";
    static final String PASSWORD = "a long enough password";

    /** A plugin that sends notifications. */
    public static class NotesPlugin implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            try {
                Path plugin = Files.createDirectories(PLUGINS.resolve("notify").resolve("web"));
                Files.writeString(plugin.resolve("index.js"), "export default { activate() {} };\n");
                Files.writeString(plugin.getParent().resolve("manifest.yaml"), """
                        id: dev.mosaikit.test.notify
                        version: 1.0.0
                        name: Notify (test)
                        kind: [app]
                        platform: '>=0.1 <1'
                        frontend:
                          entry: web/index.js
                        """);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
            return Map.of("mosaikit.plugins.directory", PLUGINS.toString());
        }
    }

    private String ada;
    private String bea;
    private String stranger;

    @BeforeEach
    void people() {
        for (String slug : new String[] {SLUG, "activity-other"}) {
            asAdmin()
                    .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                    .post("/api/v1/organizations");
        }
        ada = register(SLUG);
        bea = register(SLUG);
        stranger = register("activity-other");
    }

    private static String register(String organization) {
        String email = unique("activity") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static RequestSpecification in(String person) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", SLUG);
    }

    private static void notify(String from, List<String> to, String kind, String link, int status) {
        var body = new java.util.HashMap<String, Object>(
                Map.of("plugin", PLUGIN, "to", to, "kind", kind, "title", "Ada mentioned you", "body", "In Notes"));
        if (link != null) {
            body.put("link", link);
        }
        in(from).body(body).post("/api/v1/notifications").then().statusCode(status);
    }

    @Test
    void keepsTheNotificationsInTheFeedOfThePeopleOfTheOrganization() {
        notify(ada, List.of(bea, stranger), "mention", "/app/notes", 202);

        String id = in(bea).get("/api/v1/notifications")
                .then()
                .statusCode(200)
                .body("unread", equalTo(1))
                .body("notifications", hasSize(1))
                .body("notifications[0].title", equalTo("Ada mentioned you"))
                .body("notifications[0].link", equalTo("/app/notes"))
                .body("notifications[0].read", equalTo(false))
                .extract()
                .path("notifications[0].id");
        // A person of another organization is not notified.
        as(stranger, PASSWORD)
                .header("X-Mosaikit-Organization", "activity-other")
                .get("/api/v1/notifications")
                .then()
                .body("notifications", hasSize(0));

        in(bea).post("/api/v1/notifications/" + id + "/read").then().statusCode(204);
        in(bea).get("/api/v1/notifications")
                .then()
                .body("unread", equalTo(0))
                .body("notifications[0].read", equalTo(true));
        // Only the person can mark their notifications.
        in(ada).post("/api/v1/notifications/" + id + "/read").then().statusCode(404);
    }

    @Test
    void leavesOutTheKindsThatThePersonTurnedOff() {
        in(bea).body(Map.of("hiddenApps", List.of(), "mutedNotifications", List.of(PLUGIN + "/mention")))
                .put("/api/v1/accounts/me/preferences")
                .then()
                .statusCode(200);

        notify(ada, List.of(bea), "mention", null, 202);
        notify(ada, List.of(bea), "assignment", null, 202);

        in(bea).get("/api/v1/notifications")
                .then()
                .body("notifications.kind", org.hamcrest.Matchers.contains("assignment"));
        in(bea).post("/api/v1/notifications/read").then().statusCode(204);
        in(bea).get("/api/v1/notifications").then().body("unread", equalTo(0));
    }

    @Test
    void refusesNotificationsThatTheShellCannotShow() {
        notify(ada, List.of(bea), "Mention!", null, 400);
        notify(ada, List.of(bea), "mention", "https://elsewhere.example/phish", 400);
        notify(ada, List.of(bea), "mention", "//elsewhere.example", 400);
        in(ada).body(Map.of("plugin", "dev.mosaikit.none", "to", List.of(bea), "kind", "x", "title", "T"))
                .post("/api/v1/notifications")
                .then()
                .statusCode(400);
        anonymous().get("/api/v1/notifications").then().statusCode(401);
    }
}
