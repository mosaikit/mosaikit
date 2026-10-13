// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.hamcrest.Matchers.startsWith;

import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.resources.ResourceRegistry;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The registry of the resources of extensions (MK-054): an extension registers, updates and removes
 * its resources, and the kernel lists them by organization, type and owner.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-054")
class ResourceRegistryTest {

    static final String EXTENSION = "dev.mosaikit.test.resources";
    static final String PARTING = "dev.mosaikit.test.parting";
    static final String PROBE = "/api/v1/test/resources/";
    static final String NOTES = PROBE + EXTENSION + "/note/";
    static final String FOLDERS = PROBE + EXTENSION + "/folder/";
    static final String PASSWORD = "a long enough password";

    @Inject
    ResourceRegistry registry;

    @Inject
    ExtensionRegistry extensions;

    private String acme;
    private String globex;
    private String ada;
    private String bea;
    private String cleo;

    @BeforeEach
    void people() {
        acme = organization();
        globex = organization();
        ada = register(acme);
        bea = register(acme);
        cleo = register(globex);
    }

    private static String organization() {
        String slug = unique("resources");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("resources") + "@example.org";
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

    private static Map<String, Object> details(String title, String link, String parent) {
        Map<String, Object> body = new HashMap<>(Map.of("title", title, "link", link));
        if (parent != null) {
            body.put("parent", parent);
        }
        return body;
    }

    private String id(String person, String organization) {
        return in(person, organization).get("/api/v1/accounts/me").path("id");
    }

    @Test
    void registersUpdatesListsAndRemovesTheResourcesOfAnExtension() {
        String adaId = id(ada, acme);
        String organizationId =
                asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");

        in(ada, acme)
                .body(details("  Plans  ", "/app/notes/folders/f1", null))
                .put(FOLDERS + "f1")
                .then()
                .statusCode(200)
                .body("ref.extension", equalTo(EXTENSION))
                .body("ref.type", equalTo("folder"))
                .body("ref.id", equalTo("f1"))
                .body("organization", equalTo(organizationId))
                .body("owner", equalTo(adaId))
                .body("title", equalTo("Plans"))
                .body("parent", nullValue());
        in(ada, acme)
                .body(details("Garden", "/app/notes/n1", EXTENSION + "/folder/f1"))
                .put(NOTES + "n1")
                .then()
                .statusCode(200)
                .body("parent.id", equalTo("f1"));
        in(bea, acme)
                .body(details("Attic", "/app/notes/n2", null))
                .put(NOTES + "n2")
                .then()
                .statusCode(200);

        // The kernel lists them by type, and by owner.
        in(ada, acme)
                .get(PROBE + EXTENSION + "/note")
                .then()
                .statusCode(200)
                .body("title", contains("Attic", "Garden"))
                .body("find { it.ref.id == 'n1' }.parent.type", equalTo("folder"));
        in(ada, acme)
                .queryParam("owner", adaId)
                .get(PROBE + EXTENSION + "/note")
                .then()
                .body("ref.id", contains("n1"));

        // A rename changes the details, and keeps the owner.
        in(bea, acme)
                .body(details("Garden plan", "/app/notes/n1", null))
                .post(NOTES + "n1")
                .then()
                .statusCode(200)
                .body("title", equalTo("Garden plan"))
                .body("owner", equalTo(adaId))
                .body("parent", nullValue());
        in(ada, acme).get(NOTES + "n1").then().statusCode(200).body("title", equalTo("Garden plan"));

        // Removing the resource removes its entry; removing it again does nothing.
        in(ada, acme).delete(NOTES + "n1").then().statusCode(204);
        in(ada, acme).delete(NOTES + "n1").then().statusCode(204);
        in(ada, acme).get(NOTES + "n1").then().statusCode(404);
        in(ada, acme)
                .body(details("Again", "/app/notes/n1", null))
                .post(NOTES + "n1")
                .then()
                .statusCode(404);
    }

    @Test
    void registeringAgainKeepsTheOwnerAndChangesTheDetails() {
        String adaId = id(ada, acme);
        in(ada, acme)
                .body(details("Garden", "/app/notes/n1", null))
                .put(NOTES + "n1")
                .then()
                .statusCode(200);

        in(bea, acme)
                .body(details("Garden, again", "/app/notes/n1?v=2", null))
                .put(NOTES + "n1")
                .then()
                .statusCode(200)
                .body("owner", equalTo(adaId))
                .body("title", equalTo("Garden, again"))
                .body("link", equalTo("/app/notes/n1?v=2"));
        in(ada, acme).get(PROBE + EXTENSION + "/note").then().body("$", hasSize(1));
    }

    @Test
    void refusesTypesThatTheExtensionDoesNotDeclareAndExtensionsThatAreNotInstalled() {
        in(ada, acme)
                .body(details("Garden", "/app/notes/n1", null))
                .put(PROBE + EXTENSION + "/dashboard/d1")
                .then()
                .statusCode(400)
                .body("[0]", equalTo("The extension " + EXTENSION + " does not declare the resource type dashboard."));
        // An installed extension that declares no resources.
        in(ada, acme)
                .body(details("Hi", "/app/notify", null))
                .put(PROBE + "dev.mosaikit.test.notify/note/n1")
                .then()
                .statusCode(400);
        in(ada, acme)
                .body(details("Hi", "/app/x", null))
                .put(PROBE + "dev.example.absent/note/n1")
                .then()
                .statusCode(400)
                .body("[0]", equalTo("dev.example.absent is not an active extension."));
        in(ada, acme).get(PROBE + "dev.example.absent/note").then().statusCode(400);
        in(ada, acme).get(PROBE + "dev.example.absent/note/n1").then().statusCode(400);
        in(ada, acme).delete(PROBE + "dev.example.absent/note/n1").then().statusCode(400);
        // Links outside the shell.
        in(ada, acme)
                .body(Map.of("title", "x", "link", "https://elsewhere.example/n1"))
                .put(NOTES + "n1")
                .then()
                .statusCode(400);
        anonymous().get(PROBE + EXTENSION + "/note").then().statusCode(401);
    }

    @Test
    void acceptsOnlyAParentOfTheOrganizationThatDoesNotContainTheResource() {
        in(ada, acme)
                .body(details("Missing parent", "/app/notes/n1", EXTENSION + "/folder/none"))
                .put(NOTES + "n1")
                .then()
                .statusCode(400)
                .body("[0]", startsWith("The parent " + EXTENSION + "/folder/none is not a resource"));
        in(ada, acme)
                .body(details("Self", "/app/notes/n1", EXTENSION + "/note/n1"))
                .put(NOTES + "n1")
                .then()
                .statusCode(400);
        // A folder of another organization is not a parent.
        in(cleo, globex)
                .body(details("Theirs", "/app/notes/folders/g1", null))
                .put(FOLDERS + "g1")
                .then()
                .statusCode(200);
        in(ada, acme)
                .body(details("Garden", "/app/notes/n1", EXTENSION + "/folder/g1"))
                .put(NOTES + "n1")
                .then()
                .statusCode(400);

        // A folder cannot go into a folder that it contains.
        in(ada, acme)
                .body(details("Outer", "/app/f/outer", null))
                .put(FOLDERS + "outer")
                .then()
                .statusCode(200);
        in(ada, acme)
                .body(details("Inner", "/app/f/inner", EXTENSION + "/folder/outer"))
                .put(FOLDERS + "inner")
                .then()
                .statusCode(200);
        in(ada, acme)
                .body(details("Outer", "/app/f/outer", EXTENSION + "/folder/inner"))
                .post(FOLDERS + "outer")
                .then()
                .statusCode(400);

        // Removing a parent leaves its children without a parent.
        in(ada, acme).delete(FOLDERS + "outer").then().statusCode(204);
        in(ada, acme).get(FOLDERS + "inner").then().statusCode(200).body("parent", nullValue());
    }

    @Test
    void anotherOrganizationNeverSeesTheEntries() {
        in(ada, acme)
                .body(details("Garden", "/app/notes/n1", null))
                .put(NOTES + "n1")
                .then()
                .statusCode(200);

        in(cleo, globex).get(NOTES + "n1").then().statusCode(404);
        in(cleo, globex).get(PROBE + EXTENSION + "/note").then().statusCode(200).body("$", hasSize(0));
        in(cleo, globex)
                .body(details("Mine", "/app/notes/n1", null))
                .post(NOTES + "n1")
                .then()
                .statusCode(404);
        in(cleo, globex).delete(NOTES + "n1").then().statusCode(204);
        in(ada, acme).get(NOTES + "n1").then().statusCode(200).body("title", equalTo("Garden"));

        // The same reference in another organization is another entry.
        String cleoId = id(cleo, globex);
        in(cleo, globex)
                .body(details("Their garden", "/app/notes/n1", null))
                .put(NOTES + "n1")
                .then()
                .statusCode(200)
                .body("owner", equalTo(cleoId));
        in(ada, acme).get(NOTES + "n1").then().body("title", equalTo("Garden"));

        // Row-level security: plain SQL without a filter sees only the entries of the organization.
        in(cleo, globex)
                .get(PROBE + "visible")
                .then()
                .statusCode(200)
                .body("$", hasItem(EXTENSION + "/note/n1"))
                .body("$", hasSize(1));
    }

    @Test
    void uninstallingAnExtensionRemovesItsEntriesInEveryOrganization() throws Exception {
        in(ada, acme)
                .body(details("Leaving", "/app/parting/p1", null))
                .put(PROBE + PARTING + "/note/p1")
                .then()
                .statusCode(200);
        in(cleo, globex)
                .body(details("Leaving too", "/app/parting/p2", null))
                .put(PROBE + PARTING + "/note/p2")
                .then()
                .statusCode(200);
        in(ada, acme)
                .body(details("Staying", "/app/notes/n1", null))
                .put(NOTES + "n1")
                .then()
                .statusCode(200);

        // What the kernel does at start once the extension is no longer in the installation: outside
        // a request, as the owner of the tables, so that every organization is cleaned.
        List<String> installed = extensions.all().stream()
                .map(InstalledExtension::key)
                .filter(key -> !key.equals(PARTING))
                .toList();
        int removed = CompletableFuture.supplyAsync(() -> registry.forgetUninstalled(installed))
                .get();

        assertThat(removed).isGreaterThanOrEqualTo(2);
        in(ada, acme).get(PROBE + "visible").then().body("$", everyItem(not(startsWith(PARTING))));
        in(cleo, globex).get(PROBE + "visible").then().body("$", everyItem(not(startsWith(PARTING))));
        in(ada, acme).get(NOTES + "n1").then().statusCode(200);
    }
}
