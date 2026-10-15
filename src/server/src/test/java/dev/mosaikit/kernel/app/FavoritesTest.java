// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.ExtensionDependencyTest.CATALOG;
import static dev.mosaikit.kernel.app.ExtensionDependencyTest.DASHBOARDS;
import static dev.mosaikit.kernel.app.ExtensionDependencyTest.EXTENSIONS;
import static dev.mosaikit.kernel.app.ExtensionDependencyTest.MAPS;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.notNullValue;

import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.ValidatableResponse;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Favorites across extensions (MK-094): a person marks resources of different extensions, registered
 * with the kernel, and finds them in one list, each with the link that opens it in its extension. A
 * favorite the person may no longer read leaves the list; one whose extension is absent stays, as a
 * placeholder (MK-135). It shares the kernel of {@link ExtensionDependencyTest}, whose extensions have
 * no Java code, so that each operation takes effect at once.
 */
@QuarkusTest
@TestProfile(ExtensionDependencyTest.Catalog.class)
@Tag("MK-094")
class FavoritesTest {

    static final String PASSWORD = "a long enough password";
    static final String FAVORITES = "/api/v1/favorites";
    static final String MAP = FAVORITES + "/" + MAPS + "/map/m1";
    static final String DASHBOARD = FAVORITES + "/" + DASHBOARDS + "/dashboard/d1";

    @Inject
    ExtensionRegistry registry;

    @AfterEach
    void uninstallEverything() throws IOException {
        try (Stream<Path> files = Files.list(EXTENSIONS)) {
            for (Path file :
                    files.filter(path -> path.toString().endsWith(".zip")).toList()) {
                Files.delete(file);
            }
        }
        registry.reload();
    }

    /**
     * An organization with a map and a dashboard of Ada, which Bea may view (with the ids of her
     * grants), Carla, an administrator who may view the map, and Dan, who may view neither.
     */
    private record Town(String slug, String ada, String bea, String carla, String dan, Map<String, String> grants) {}

    private static Town town() {
        install(DASHBOARDS);
        install(MAPS);
        String slug = unique("favorites");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        String ada = person(slug);
        String bea = person(slug);
        String carla = person(slug);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", slug, carla)
                .then()
                .statusCode(200);
        register(slug, ada, MAPS + "/map/m1", "Rivers", "/app/maps/m1");
        register(slug, ada, DASHBOARDS + "/dashboard/d1", "Water", "/app/dashboards/d1");
        Map<String, String> grants = Map.of(
                "map", share(slug, ada, MAPS + "/map/m1", bea),
                "dashboard", share(slug, ada, DASHBOARDS + "/dashboard/d1", bea));
        share(slug, ada, MAPS + "/map/m1", carla);
        return new Town(slug, ada, bea, carla, person(slug), grants);
    }

    @Test
    void aPersonMarksResourcesOfAnyExtensionAndFindsThemInOneList() {
        Town town = town();

        in(town.bea(), town.slug())
                .put(MAP)
                .then()
                .statusCode(200)
                .body("extension", equalTo(MAPS))
                .body("type", equalTo("map"))
                .body("id", equalTo("m1"))
                .body("status", equalTo("available"))
                .body("title", equalTo("Rivers"))
                .body("markedAt", notNullValue());
        in(town.bea(), town.slug()).put(DASHBOARD).then().statusCode(200);
        // Marking again changes nothing.
        in(town.bea(), town.slug()).put(MAP).then().statusCode(200);

        // One list, across the two extensions, the last marked first.
        list(town.bea(), town.slug())
                .body("extension", equalTo(List.of(DASHBOARDS, MAPS)))
                .body("title", equalTo(List.of("Water", "Rivers")))
                .body("status", equalTo(List.of("available", "available")));
        in(town.bea(), town.slug()).get(MAP).then().statusCode(200).body("title", equalTo("Rivers"));
        in(town.bea(), town.slug())
                .get(FAVORITES + "/" + MAPS + "/map/m2")
                .then()
                .statusCode(404);
        // The list is of each person.
        list(town.ada(), town.slug()).body("$", empty());

        // Only a resource the person may open: neither one they may not read, nor one not registered.
        in(town.dan(), town.slug()).put(MAP).then().statusCode(404);
        in(town.dan(), town.slug())
                .put(FAVORITES + "/" + MAPS + "/map/none")
                .then()
                .statusCode(404);
        list(town.dan(), town.slug()).body("$", empty());

        // Removed: out of the list; removing again changes nothing.
        in(town.bea(), town.slug()).delete(MAP).then().statusCode(204);
        in(town.bea(), town.slug()).delete(MAP).then().statusCode(204);
        list(town.bea(), town.slug()).body("extension", equalTo(List.of(DASHBOARDS)));

        // What is not a reference, and a request without an account.
        in(town.bea(), town.slug()).put(FAVORITES + "/Maps/map/m1").then().statusCode(400);
        anonymous().get(FAVORITES).then().statusCode(401);
        anonymous().put(MAP).then().statusCode(401);
    }

    @Test
    void aFavoriteOpensTheResourceInItsExtension() {
        Town town = town();
        in(town.bea(), town.slug()).put(MAP).then().statusCode(200).body("link", equalTo("/app/maps/m1"));
        list(town.bea(), town.slug()).body("[0].link", equalTo("/app/maps/m1"));

        // The extension moves or renames the resource: the favorite follows it.
        register(town.slug(), town.ada(), MAPS + "/map/m1", "Rivers and lakes", "/app/maps/m1?zoom=3");
        list(town.bea(), town.slug())
                .body("[0].title", equalTo("Rivers and lakes"))
                .body("[0].link", equalTo("/app/maps/m1?zoom=3"));
    }

    @Test
    void aFavoriteThePersonCanNoLongerAccessDisappearsFromTheList() {
        Town town = town();
        in(town.bea(), town.slug()).put(MAP).then().statusCode(200);
        in(town.bea(), town.slug()).put(DASHBOARD).then().statusCode(200);

        // The grant revoked: the map leaves the list of Bea, the dashboard stays.
        revoke(town, town.grants().get("map"));
        list(town.bea(), town.slug()).body("extension", equalTo(List.of(DASHBOARDS)));
        in(town.bea(), town.slug()).get(MAP).then().statusCode(404);

        // Shared again: the favorite comes back, as it was.
        share(town.slug(), town.ada(), MAPS + "/map/m1", town.bea());
        list(town.bea(), town.slug()).body("extension", equalTo(List.of(DASHBOARDS, MAPS)));

        // Deleted by its extension: out of the list.
        in(town.ada(), town.slug())
                .delete("/api/v1/test/resources/" + DASHBOARDS + "/dashboard/d1")
                .then()
                .statusCode(204);
        list(town.bea(), town.slug()).body("extension", equalTo(List.of(MAPS)));
    }

    @Test
    void aFavoriteOfAnAbsentExtensionShowsAPlaceholderUntilItComesBack() {
        Town town = town();
        in(town.bea(), town.slug()).put(MAP).then().statusCode(200);
        in(town.carla(), town.slug()).put(MAP).then().statusCode(200);

        // Turned off in the organization: the title it had, no link; administrators learn what to do.
        apps(town.slug(), false);
        list(town.bea(), town.slug())
                .body("$", hasSize(1))
                .body("[0].status", equalTo("extension-absent"))
                .body("[0].title", equalTo("Rivers"))
                .body("[0]", not(hasKey("link")))
                .body("[0]", not(hasKey("missing")));
        list(town.carla(), town.slug())
                .body("[0].status", equalTo("extension-absent"))
                .body("[0].missing.extension", equalTo(MAPS))
                .body("[0].missing.action", equalTo("turn-on"));
        // A resource of an absent extension cannot be marked.
        in(town.bea(), town.slug()).put(DASHBOARD).then().statusCode(200);
        in(town.ada(), town.slug()).put(MAP).then().statusCode(404);

        // While it is off the kernel still knows the grants: a revoked one leaves the list.
        revoke(town, town.grants().get("map"));
        list(town.bea(), town.slug()).body("extension", equalTo(List.of(DASHBOARDS)));
        share(town.slug(), town.ada(), MAPS + "/map/m1", town.bea());

        // Back on: the favorite opens again.
        apps(town.slug(), true);
        in(town.bea(), town.slug())
                .get(MAP)
                .then()
                .statusCode(200)
                .body("status", equalTo("available"))
                .body("link", equalTo("/app/maps/m1"));

        // Removed from the installation: the placeholder stays, and comes back with the extension.
        asAdmin().delete("/api/v1/extensions/{id}", MAPS).then().statusCode(200);
        in(town.bea(), town.slug())
                .get(MAP)
                .then()
                .statusCode(200)
                .body("status", equalTo("extension-absent"))
                .body("title", equalTo("Rivers"));
        list(town.carla(), town.slug()).body("[0].missing.action", equalTo("install"));
        install(MAPS);
        in(town.bea(), town.slug())
                .get(MAP)
                .then()
                .statusCode(200)
                .body("status", equalTo("available"))
                .body("link", equalTo("/app/maps/m1"));
    }

    private static void install(String id) {
        asAdmin()
                .body(Map.of("source", CATALOG.toUri().toString(), "id", id, "version", "1.0.0"))
                .post("/api/v1/marketplace/installations")
                .then()
                .statusCode(202);
    }

    private static String person(String organization) {
        String email = unique("favorites") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    private static ValidatableResponse list(String person, String organization) {
        return in(person, organization).get(FAVORITES).then().statusCode(200);
    }

    /** Registers a resource as its owner, through the probe that stands for the Java code of its extension. */
    private static void register(String organization, String owner, String ref, String title, String link) {
        in(owner, organization)
                .body(Map.of("title", title, "link", link))
                .put("/api/v1/test/resources/" + ref)
                .then()
                .statusCode(200);
    }

    /** Shares a resource with a person to view, as its owner; the id of the grant. */
    private static String share(String organization, String owner, String ref, String person) {
        String[] parts = ref.split("/");
        return in(owner, organization)
                .body(Map.of("subject", Map.of("kind", "person", "email", person), "level", "view"))
                .put("/api/v1/sharing/resources/{extension}/{type}/{id}/grants", parts[0], parts[1], parts[2])
                .then()
                .statusCode(200)
                .extract()
                .path("id");
    }

    private static void revoke(Town town, String grant) {
        in(town.ada(), town.slug())
                .delete("/api/v1/sharing/grants/{grant}", grant)
                .then()
                .statusCode(204);
    }

    /** Turns the app of the maps on or off in an organization. */
    private static void apps(String organization, boolean on) {
        asAdmin()
                .body(List.of(Map.of(
                        "extensionId", MAPS, "appId", "maps", "enabled", on, "pinned", false, "roles", List.of())))
                .put("/api/v1/organizations/{slug}/apps", organization)
                .then()
                .statusCode(200);
    }
}
