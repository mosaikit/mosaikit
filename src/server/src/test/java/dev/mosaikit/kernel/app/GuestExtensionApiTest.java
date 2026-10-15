// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;

import dev.mosaikit.kernel.api.extension.ExtensionManifests;
import dev.mosaikit.kernel.api.extension.ManifestParseResult;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.ExtensionStatus;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.system.KernelVersion;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.specification.RequestSpecification;
import jakarta.enterprise.inject.Vetoed;
import jakarta.inject.Inject;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Guests of an organization and the APIs of extensions (MK-032, MK-055, MK-056): a guest reaches the
 * backend of an extension once the organization gave them something of it, a permission through a
 * team or an exception, or a resource shared with them or a team of theirs, and there exactly what
 * is shared with them and what their permissions allow; nothing else of the organization.
 */
@QuarkusTest
@Tag("MK-032")
@Tag("MK-055")
@Tag("MK-056")
class GuestExtensionApiTest {

    static final String API = "guest-probe";
    static final String EXTENSION = "dev.mosaikit.test.guestprobe";

    private static final String PASSWORD = "a long enough password";
    private static final String ITEMS = "/api/v1/ext/" + API + "/items/";
    private static final String CREATE = EXTENSION + ":create-item";
    private static final String NOTHING_GIVEN = "only when a team of theirs or an exception grants them";

    @Inject
    ExtensionRegistry registry;

    @Inject
    KernelConfig config;

    @Inject
    KernelVersion version;

    private String town;
    private String other;
    private String boss;
    private String ada;
    private String guest;

    /** The registry of the kernel, with an active extension whose backend is {@link GuestApiProbe}. */
    @Vetoed
    static final class WithProbe extends ExtensionRegistry {

        private final List<InstalledExtension> all;

        WithProbe(KernelConfig config, KernelVersion version, List<InstalledExtension> real) {
            super(config, version, null, null);
            List<InstalledExtension> extensions = new ArrayList<>(real);
            extensions.add(probe());
            this.all = List.copyOf(extensions);
        }

        @Override
        public List<InstalledExtension> all() {
            return all;
        }

        @Override
        public List<InstalledExtension> active() {
            return all.stream().filter(InstalledExtension::isActive).toList();
        }

        @Override
        public Optional<InstalledExtension> findActive(String id) {
            return active().stream()
                    .filter(extension -> extension.key().equals(id))
                    .findFirst();
        }

        private static InstalledExtension probe() {
            Map<String, Object> tree = Map.of(
                    "id",
                    EXTENSION,
                    "version",
                    "1.0.0",
                    "name",
                    "Guest probe (test)",
                    "kind",
                    List.of("app"),
                    "platform",
                    ">=0.1 <1",
                    "backend",
                    Map.of("jar", "lib/probe.jar", "api", API),
                    "permissions",
                    List.of(
                            Map.of("name", "create-item", "title", "Create items"),
                            Map.of("name", "export-items", "title", "Export items")),
                    "resources",
                    List.of(Map.of(
                            "type", "item",
                            "title", "Item",
                            "levels",
                                    List.of(
                                            Map.of("name", "view", "title", "View"),
                                            Map.of("name", "edit", "title", "Edit", "edits", true)))));
            var manifest = ((ManifestParseResult.Valid) ExtensionManifests.parse(tree)).manifest();
            return new InstalledExtension(
                    manifest.id(),
                    Path.of("extensions", "guest-probe"),
                    Optional.of(manifest),
                    ExtensionStatus.ACTIVE,
                    List.of());
        }
    }

    @BeforeEach
    void setUp() {
        QuarkusMock.installMockForType(new WithProbe(config, version, registry.all()), ExtensionRegistry.class);
        town = organization();
        other = organization();
        boss = register(town);
        ada = register(town);
        guest = register(other);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", town, boss)
                .then()
                .statusCode(200);
    }

    // --- Helpers -------------------------------------------------------------------------------

    private static String organization() {
        String slug = unique("guests");
        asAdmin()
                .body(Map.of("slug", slug, "name", "Org " + slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("guests") + "@example.org";
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

    private RequestSpecification asGuest() {
        return in(guest, town);
    }

    /** A private team of the organization, owned by {@code owner}, with its members and guests. */
    private String team(String owner, Map<String, String> people) {
        String team = in(owner, town)
                .body(Map.of("name", unique("team"), "description", "A team", "visibility", "private"))
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
        people.forEach((person, role) -> in(owner, town)
                .body(Map.of("role", role))
                .put("/api/v1/teams/" + team + "/members/" + person)
                .then()
                .statusCode(200));
        return team;
    }

    /** An item registered by a member of the organization, who owns it. */
    private void item(String owner, String id) {
        in(owner, town)
                .body(Map.of("title", "Item " + id, "link", "/app/guest-probe/" + id))
                .put("/api/v1/test/resources/" + EXTENSION + "/item/" + id)
                .then()
                .statusCode(200);
    }

    private void share(String owner, String id, String kind, String subject, String level) {
        Map<String, Object> who = new HashMap<>();
        who.put("kind", kind);
        if (subject != null) {
            who.put("id", subject);
        }
        in(owner, town)
                .body(Map.of("subject", who, "level", level))
                .put("/api/v1/sharing/resources/" + EXTENSION + "/item/" + id + "/grants")
                .then()
                .statusCode(200);
    }

    private String id(String person, String organization) {
        return in(person, organization).get("/api/v1/accounts/me").path("id");
    }

    private String permissions() {
        return "/api/v1/organizations/" + town + "/permissions";
    }

    // --- Tests ---------------------------------------------------------------------------------

    @Test
    void aGuestGivenNothingOfAnExtensionIsRefusedItsApi() {
        String roads = team(ada, Map.of(guest, "guest"));
        item(ada, "a");
        share(ada, "a", "organization", null, "edit");

        // In a team, but with no permission of the extension and nothing of it shared with them: the
        // items of the organization stay out of reach, even those shared with the whole organization.
        asGuest().get(ITEMS).then().statusCode(403).body("detail", containsString(NOTHING_GIVEN));
        asGuest().get(ITEMS + "a").then().statusCode(403);
        // A member of the same team reaches the API as before.
        in(ada, town).get(ITEMS).then().statusCode(200).body("$", contains("a"));
        // A permission granted to another team, without the guest, gives them nothing.
        String bridges = team(ada, Map.of());
        in(boss, town)
                .put(permissions() + "/teams/{id}/{permission}", bridges, CREATE)
                .then()
                .statusCode(200);
        asGuest().get(ITEMS).then().statusCode(403);
        asGuest().get("/api/v1/teams").then().statusCode(200).body("id", contains(roads));
    }

    @Test
    void aGuestReachesExactlyWhatIsSharedWithThemAndTheirTeams() {
        String roads = team(ada, Map.of(guest, "guest"));
        String bridges = team(ada, Map.of());
        for (String id : List.of("a", "b", "c", "d", "e")) {
            item(ada, id);
        }
        share(ada, "a", "group", roads, "view");
        share(ada, "b", "organization", null, "edit");
        share(ada, "c", "group", bridges, "edit");
        share(ada, "d", "person", id(guest, town), "edit");

        asGuest().get(ITEMS).then().statusCode(200).body("$", contains("a", "d"));
        asGuest().get(ITEMS + "a").then().statusCode(200).body("level", equalTo("view"));
        asGuest().put(ITEMS + "a").then().statusCode(403);
        asGuest().put(ITEMS + "d").then().statusCode(204);
        // What is shared with the organization, with another team or with nobody is not found.
        for (String hidden : List.of("b", "c", "e")) {
            asGuest().get(ITEMS + hidden).then().statusCode(404);
            asGuest().put(ITEMS + hidden).then().statusCode(404);
        }
        // Being let in grants no permission.
        asGuest().post(ITEMS + "f").then().statusCode(403);
        // The rest of MK-032 holds: routes of the extension for members, the people of the
        // organization, its administration, the assistant and the other APIs.
        asGuest().get("/api/v1/ext/" + API + "/members-only").then().statusCode(403);
        asGuest().get("/api/v1/organizations/{slug}/members", town).then().statusCode(403);
        asGuest().get(permissions() + "/teams/{id}", roads).then().statusCode(403);
        asGuest().get("/api/v1/organizations/{slug}/apps", town).then().statusCode(403);
        asGuest().get("/api/v1/ai/tools").then().statusCode(403);
        asGuest().get("/api/v1/test/resources/" + EXTENSION + "/item").then().statusCode(403);
        // In their own organization the person is a member, and sees none of this.
        in(guest, other).get(ITEMS).then().statusCode(200).body("$", empty());

        // Once the shares are revoked and nothing else is given, the API is closed again.
        for (String id : List.of("a", "d")) {
            String grant = in(ada, town)
                    .get("/api/v1/sharing/resources/" + EXTENSION + "/item/" + id + "/grants")
                    .then()
                    .statusCode(200)
                    .extract()
                    .path("[0].id");
            in(ada, town).delete("/api/v1/sharing/grants/" + grant).then().statusCode(204);
        }
        asGuest().get(ITEMS).then().statusCode(403);
    }

    @Test
    void aGuestHoldsWhatThePermissionsOfTheirTeamsAndExceptionsAllow() {
        String roads = team(ada, Map.of(guest, "guest"));
        asGuest().post(ITEMS + "x").then().statusCode(403).body("detail", containsString(NOTHING_GIVEN));

        // Granted to their team: the guest creates an item, owns it, and sees only theirs.
        in(boss, town)
                .put(permissions() + "/teams/{id}/{permission}", roads, CREATE)
                .then()
                .statusCode(200);
        item(ada, "y");
        asGuest().post(ITEMS + "x").then().statusCode(201);
        asGuest().get(ITEMS).then().statusCode(200).body("$", contains("x"));
        asGuest().get(ITEMS + "x").then().statusCode(200).body("level", equalTo("edit"));
        asGuest().get(ITEMS + "y").then().statusCode(404);
        asGuest().get("/api/v1/ext/" + API + "/members-only").then().statusCode(403);

        // Taken from the team, the permission is gone: the guest still reaches what they own, and
        // creates nothing more.
        in(boss, town)
                .delete(permissions() + "/teams/{id}/{permission}", roads, CREATE)
                .then()
                .statusCode(200);
        asGuest().get(ITEMS).then().statusCode(200).body("$", contains("x"));
        asGuest().post(ITEMS + "z").then().statusCode(403);

        // A personal exception counts the same way.
        in(boss, town)
                .put(permissions() + "/members/{email}/exceptions/{permission}", guest, CREATE)
                .then()
                .statusCode(200);
        asGuest().post(ITEMS + "z").then().statusCode(201);
        asGuest().get(ITEMS).then().statusCode(200).body("$", contains("x", "z"));
    }
}
