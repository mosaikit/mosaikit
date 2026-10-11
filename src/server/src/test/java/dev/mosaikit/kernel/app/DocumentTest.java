// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The collections of documents of plugins without a backend (ADR-0031). */
@QuarkusTest
@TestProfile(DocumentTest.DataPlugin.class)
@Tag("MK-046")
class DocumentTest {

    static final Path PLUGINS = Path.of("target", "document-test", "plugins").toAbsolutePath();
    static final String PLUGIN = "dev.mosaikit.test.todo";
    static final String ITEMS = "/api/v1/data/" + PLUGIN + "/items";
    static final String PASSWORD = "a long enough password";

    /** A plugin with only a frontend and the collection "items". */
    public static class DataPlugin implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            try {
                Path plugin = Files.createDirectories(PLUGINS.resolve("todo"));
                Files.createDirectories(plugin.resolve("web"));
                Files.writeString(plugin.resolve("web/index.js"), "export default { activate() {} };\n");
                Files.writeString(plugin.resolve("manifest.yaml"), """
                        id: dev.mosaikit.test.todo
                        version: 1.0.0
                        name: To do (test)
                        kind: [app]
                        platform: '>=0.1 <1'
                        frontend:
                          entry: web/index.js
                        data:
                          collections: [items]
                        """);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
            return Map.of("mosaikit.plugins.directory", PLUGINS.toString());
        }
    }

    private String ada;
    private String bea;

    @BeforeEach
    void people() {
        for (String slug : new String[] {"data-acme", "data-globex"}) {
            asAdmin()
                    .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                    .post("/api/v1/organizations");
        }
        ada = register("data-acme");
        bea = register("data-globex");
    }

    private static String register(String organization) {
        String email = unique("person") + "@example.org";
        anonymous()
                .body(Map.of(
                        "organization", organization,
                        "email", email,
                        "displayName", "Person",
                        "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    @Test
    void keepsTheDocumentsOfEachOrganizationApart() {
        String id = in(ada, "data-acme")
                .body(Map.of("title", "Paint the fence", "done", false))
                .post(ITEMS)
                .then()
                .statusCode(201)
                .header("Location", containsString(ITEMS + "/"))
                .body("data.title", equalTo("Paint the fence"))
                .body("createdBy", equalTo(ada))
                .body("version", notNullValue())
                .extract()
                .path("id");

        in(ada, "data-acme").get(ITEMS).then().statusCode(200).body("data.title", hasSize(1));
        in(ada, "data-acme").get(ITEMS + "/" + id).then().statusCode(200);
        // Another organization sees nothing, not even with the identifier.
        in(bea, "data-globex").get(ITEMS).then().statusCode(200).body("$", hasSize(0));
        in(bea, "data-globex").get(ITEMS + "/" + id).then().statusCode(404);
        in(bea, "data-globex")
                .body(Map.of("title", "x"))
                .put(ITEMS + "/" + id)
                .then()
                .statusCode(404);
        in(bea, "data-globex").delete(ITEMS + "/" + id).then().statusCode(404);
    }

    @Test
    void replacesWithTheVersionReadAndDeletes() {
        var created = in(ada, "data-acme")
                .body(Map.of("title", "Mow the lawn"))
                .post(ITEMS)
                .then()
                .statusCode(201)
                .extract();
        String id = created.path("id");
        int version = created.path("version");

        int updated = in(ada, "data-acme")
                .header("If-Match", String.valueOf(version))
                .body(Map.of("title", "Mow the lawn", "done", true))
                .put(ITEMS + "/" + id)
                .then()
                .statusCode(200)
                .body("data.done", equalTo(true))
                .extract()
                .path("version");
        // A second writer with the old version is refused instead of overwriting.
        in(ada, "data-acme")
                .header("If-Match", String.valueOf(version))
                .body(Map.of("title", "Mow"))
                .put(ITEMS + "/" + id)
                .then()
                .statusCode(409);
        in(ada, "data-acme")
                .header("If-Match", String.valueOf(updated))
                .body(Map.of("title", "Mow"))
                .put(ITEMS + "/" + id)
                .then()
                .statusCode(200);

        in(ada, "data-acme").delete(ITEMS + "/" + id).then().statusCode(204);
        in(ada, "data-acme").get(ITEMS + "/" + id).then().statusCode(404);
    }

    @Test
    void offersOnlyTheDeclaredCollectionsOfActivePlugins() {
        in(ada, "data-acme").get("/api/v1/data/" + PLUGIN + "/other").then().statusCode(404);
        in(ada, "data-acme").get("/api/v1/data/dev.mosaikit.none/items").then().statusCode(404);
        in(ada, "data-acme").body("[1, 2]").post(ITEMS).then().statusCode(400);
        // Without an organization there is nothing to read; without an account, nothing at all.
        asAdmin().get(ITEMS).then().statusCode(403);
        anonymous().get(ITEMS).then().statusCode(401);
    }

    @Test
    void showsTheCollectionsToTheShell() {
        in(ada, "data-acme")
                .get("/api/v1/shell/plugins")
                .then()
                .statusCode(200)
                .body("find { it.id == '" + PLUGIN + "' }.bridge.data", equalTo("/api/v1/data/" + PLUGIN + "/"));
    }
}
