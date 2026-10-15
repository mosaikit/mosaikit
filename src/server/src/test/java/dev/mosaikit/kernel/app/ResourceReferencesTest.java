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
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;

import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.ValidatableResponse;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * References between resources of different extensions (MK-135): a dashboard of one extension refers
 * to a map of another through the registry of resources, and the kernel resolves the reference to the
 * map or to why it is not available. Turning the extension of the maps off, removing it and installing
 * it again change neither the reference nor the resources, and the reference works again as soon as
 * the extension comes back. It shares the kernel of {@link ExtensionDependencyTest}, whose extensions
 * have no Java code, so that each operation takes effect at once.
 */
@QuarkusTest
@TestProfile(ExtensionDependencyTest.Catalog.class)
@Tag("MK-135")
class ResourceReferencesTest {

    static final String PASSWORD = "a long enough password";
    static final String RESOLVE = "/api/v1/resources/references/resolve";
    static final Map<String, String> MAP = Map.of("extension", MAPS, "type", "map", "id", "m1");
    static final Map<String, String> DASHBOARD = Map.of("extension", DASHBOARDS, "type", "dashboard", "id", "d1");

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

    /** An organization with a map of Ada, which Bea may view, a dashboard that refers to it, and Carla, an administrator. */
    private record Town(String slug, String ada, String bea, String carla, String dan) {}

    private static Town town() {
        install(DASHBOARDS);
        install(MAPS);
        String slug = unique("references");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        Town town = new Town(slug, person(slug), person(slug), person(slug), person(slug));
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", slug, town.carla())
                .then()
                .statusCode(200);
        register(town, MAPS + "/map/m1", "Rivers", "/app/maps/m1");
        register(town, DASHBOARDS + "/dashboard/d1", "Water", "/app/dashboards/d1");
        in(town.ada(), slug)
                .body(Map.of("subject", Map.of("kind", "person", "email", town.bea()), "level", "view"))
                .put("/api/v1/sharing/resources/{extension}/map/m1/grants", MAPS)
                .then()
                .statusCode(200);
        return town;
    }

    @Test
    void resolvesAReferenceToTheResourceOrToWhyItIsNotAvailable() {
        Town town = town();

        // The extension of the dashboards resolves, in its Java code, the map its widget shows.
        probe(town.ada(), town.slug(), DASHBOARDS, "map/m1")
                .statusCode(200)
                .body("availability", equalTo("AVAILABLE"))
                .body("target.extension", equalTo(MAPS))
                .body("resource.title", equalTo("Rivers"))
                .body("resource.link", equalTo("/app/maps/m1"));
        resolve(town.bea(), town.slug(), MAP)
                .body("[0].status", equalTo("available"))
                .body("[0].extension", equalTo(MAPS))
                .body("[0].type", equalTo("map"))
                .body("[0].id", equalTo("m1"))
                .body("[0].title", equalTo("Rivers"))
                .body("[0].link", equalTo("/app/maps/m1"));

        // No right to read it: the reason, and nothing of the resource.
        probe(town.dan(), town.slug(), DASHBOARDS, "map/m1").body("availability", equalTo("FORBIDDEN"));
        resolve(town.dan(), town.slug(), MAP)
                .body("[0].status", equalTo("forbidden"))
                .body("[0]", not(hasKey("title")))
                .body("[0]", not(hasKey("link")));

        // Deleted by its extension: no longer in the registry.
        register(town, MAPS + "/map/m2", "Roads", "/app/maps/m2");
        in(town.ada(), town.slug())
                .delete("/api/v1/test/resources/" + MAPS + "/map/m2")
                .then()
                .statusCode(204);
        Map<String, String> deleted = Map.of("extension", MAPS, "type", "map", "id", "m2");
        resolve(town.ada(), town.slug(), deleted).body("[0].status", equalTo("deleted"));
        probe(town.ada(), town.slug(), DASHBOARDS, "map/m2").body("availability", equalTo("DELETED"));
        // A type the extension does not declare has no resources.
        resolve(town.ada(), town.slug(), Map.of("extension", MAPS, "type", "chart", "id", "m1"))
                .body("[0].status", equalTo("deleted"));

        // Several at once, in the order asked.
        resolve(town.bea(), town.slug(), MAP, deleted, DASHBOARD)
                .body("status", equalTo(List.of("available", "deleted", "forbidden")));

        // Only an active extension calls the bean, naming itself.
        probe(town.ada(), town.slug(), "dev.mosaikit.test.absent", "map/m1").statusCode(400);
        // The REST API refuses what is not a reference, and too many at once.
        in(town.ada(), town.slug()).body(List.of()).post(RESOLVE).then().statusCode(400);
        in(town.ada(), town.slug())
                .body(List.of(Map.of("extension", "Maps", "type", "map", "id", "1")))
                .post(RESOLVE)
                .then()
                .statusCode(400);
        in(town.ada(), town.slug())
                .body(Collections.nCopies(101, MAP))
                .post(RESOLVE)
                .then()
                .statusCode(400);
        anonymous().body(List.of(MAP)).post(RESOLVE).then().statusCode(401);
    }

    @Test
    void anAbsentExtensionLeavesAPlaceholderAndComesBackWithNothingToRepair() {
        Town town = town();
        Object map = entry(town, MAPS + "/map/m1");
        Object dashboard = entry(town, DASHBOARDS + "/dashboard/d1");

        // Turned off in the organization: the reason, and to administrators the extension to turn on.
        apps(town.slug(), false);
        resolve(town.bea(), town.slug(), MAP)
                .body("[0].status", equalTo("extension-absent"))
                .body("[0].extension", equalTo(MAPS))
                .body("[0]", not(hasKey("title")))
                .body("[0]", not(hasKey("missing")));
        resolve(town.carla(), town.slug(), MAP)
                .body("[0].status", equalTo("extension-absent"))
                .body("[0].missing.extension", equalTo(MAPS))
                .body("[0].missing.name", equalTo("maps"))
                .body("[0].missing.action", equalTo("turn-on"));
        probe(town.ada(), town.slug(), DASHBOARDS, "map/m1").body("availability", equalTo("EXTENSION_ABSENT"));
        // The rest of the dashboard works: its own entry resolves.
        resolve(town.ada(), town.slug(), DASHBOARD).body("[0].status", equalTo("available"));

        // Back on: the reference works again, as it was.
        apps(town.slug(), true);
        resolve(town.bea(), town.slug(), MAP)
                .body("[0].status", equalTo("available"))
                .body("[0].title", equalTo("Rivers"));

        // Removed from the installation: administrators are told to install it.
        asAdmin().delete("/api/v1/extensions/{id}", MAPS).then().statusCode(200);
        resolve(town.bea(), town.slug(), MAP)
                .body("[0].status", equalTo("extension-absent"))
                .body("[0]", not(hasKey("missing")));
        resolve(town.carla(), town.slug(), MAP)
                .body("[0].missing.extension", equalTo(MAPS))
                .body("[0].missing.name", nullValue())
                .body("[0].missing.action", equalTo("install"));
        resolve(town.ada(), town.slug(), DASHBOARD).body("[0].status", equalTo("available"));

        // Installed again: the same reference resolves, with the grant of Bea, and nothing was changed.
        install(MAPS);
        resolve(town.bea(), town.slug(), MAP)
                .body("[0].status", equalTo("available"))
                .body("[0].title", equalTo("Rivers"));
        assertThat(entry(town, MAPS + "/map/m1")).isEqualTo(map);
        assertThat(entry(town, DASHBOARDS + "/dashboard/d1")).isEqualTo(dashboard);
    }

    private static void install(String id) {
        asAdmin()
                .body(Map.of("source", CATALOG.toUri().toString(), "id", id, "version", "1.0.0"))
                .post("/api/v1/marketplace/installations")
                .then()
                .statusCode(202);
    }

    private static String person(String organization) {
        String email = unique("references") + "@example.org";
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

    /** Registers a resource as Ada, through the probe that stands for the Java code of its extension. */
    private static void register(Town town, String ref, String title, String link) {
        in(town.ada(), town.slug())
                .body(Map.of("title", title, "link", link))
                .put("/api/v1/test/resources/" + ref)
                .then()
                .statusCode(200);
    }

    /** The entry of the registry as Ada, who owns it, reads it. */
    private static Object entry(Town town, String ref) {
        return in(town.ada(), town.slug())
                .get("/api/v1/test/resources/" + ref)
                .then()
                .statusCode(200)
                .extract()
                .as(Map.class);
    }

    @SafeVarargs
    private static ValidatableResponse resolve(String person, String organization, Map<String, String>... refs) {
        return in(person, organization).body(List.of(refs)).post(RESOLVE).then().statusCode(200);
    }

    private static ValidatableResponse probe(String person, String organization, String caller, String target) {
        return in(person, organization)
                .get("/api/v1/test/references/" + caller + "/" + MAPS + "/" + target)
                .then();
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
