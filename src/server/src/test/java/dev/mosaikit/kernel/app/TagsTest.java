// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.empty;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Free tags on the resources of extensions (MK-097): an extension tags its resources through the
 * kernel API, a person gets suggestions while typing and filters a list by tags, and sees only the
 * tags of the resources they may read.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-097")
class TagsTest {

    static final String EXTENSION = "dev.mosaikit.test.resources";
    static final String REGISTRY = "/api/v1/test/resources/" + EXTENSION + "/note/";
    static final String PROBE = "/api/v1/test/tags/" + EXTENSION + "/note";
    static final String API = "/api/v1/resources/tags/";
    static final String NOTES = API + EXTENSION + "/note";
    static final String SUGGESTIONS = API + "suggestions";
    static final String PASSWORD = "a long enough password";

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
        String slug = unique("tags");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("tags") + "@example.org";
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

    private static void note(String person, String organization, String id) {
        in(person, organization)
                .body(Map.of("title", "Note " + id, "link", "/app/notes/" + id))
                .put(REGISTRY + id)
                .then()
                .statusCode(200);
    }

    /** Tags a note through the kernel API of extensions, replacing its tags. */
    private static void tag(String person, String organization, String id, String... tags) {
        in(person, organization)
                .body(List.of(tags))
                .put(PROBE + "/" + id)
                .then()
                .statusCode(200);
    }

    private static void shareToView(String owner, String organization, String id, String person) {
        String account = in(person, organization).get("/api/v1/accounts/me").path("id");
        in(owner, organization)
                .body(Map.of("subject", Map.of("kind", "person", "id", account), "level", "view"))
                .put("/api/v1/sharing/resources/" + EXTENSION + "/note/" + id + "/grants")
                .then()
                .statusCode(200);
    }

    @Test
    void anExtensionAttachesReplacesAndReadsTagsInLowercaseWithoutDuplicates() {
        note(ada, acme, "n1");

        in(ada, acme).get(PROBE + "/n1").then().statusCode(200).body("$", empty());
        in(ada, acme)
                .body(List.of("Garden", "garden ", "  Spring   Plans "))
                .post(PROBE + "/n1")
                .then()
                .statusCode(200)
                .body("$", contains("garden", "spring plans"));
        // Attaching keeps the tags the resource has and adds each new one once.
        in(ada, acme)
                .body(List.of("GARDEN", "Roses"))
                .post(PROBE + "/n1")
                .then()
                .statusCode(200)
                .body("$", contains("garden", "roses", "spring plans"));
        // Replacing keeps only the tags given.
        in(ada, acme)
                .body(List.of("Roses", "Trees", "roses"))
                .put(PROBE + "/n1")
                .then()
                .statusCode(200)
                .body("$", contains("roses", "trees"));
        in(ada, acme).get(PROBE + "/n1").then().statusCode(200).body("$", contains("roses", "trees"));

        // The REST API of the frontends reads and replaces the same tags.
        in(ada, acme).get(NOTES + "/n1").then().statusCode(200).body("$", contains("roses", "trees"));
        in(ada, acme)
                .body(List.of("Trees", "Ivy"))
                .put(NOTES + "/n1")
                .then()
                .statusCode(200)
                .body("$", contains("ivy", "trees"));

        // Not valid: a comma, too long, too many; nothing is written.
        in(ada, acme).body(List.of("a,b")).post(PROBE + "/n1").then().statusCode(400);
        in(ada, acme).body(List.of("x".repeat(49))).put(PROBE + "/n1").then().statusCode(400);
        List<String> many = new ArrayList<>();
        for (int i = 0; i < 19; i++) {
            many.add("t" + i);
        }
        in(ada, acme).body(many).post(PROBE + "/n1").then().statusCode(400);
        in(ada, acme).body(List.of("")).put(NOTES + "/n1").then().statusCode(400);
        in(ada, acme).get(PROBE + "/n1").then().statusCode(200).body("$", contains("ivy", "trees"));

        // A resource that is not registered, or of a type the extension does not declare.
        in(ada, acme).body(List.of("x")).put(PROBE + "/missing").then().statusCode(404);
        in(ada, acme)
                .body(List.of("x"))
                .put("/api/v1/test/tags/" + EXTENSION + "/map/m1")
                .then()
                .statusCode(400);

        // Emptying removes them all; the tags go with the resource when it is removed.
        in(ada, acme).body(List.of()).put(PROBE + "/n1").then().statusCode(200).body("$", empty());
        tag(ada, acme, "n1", "garden");
        in(ada, acme).delete(REGISTRY + "n1").then().statusCode(204);
        note(ada, acme, "n1");
        in(ada, acme).get(PROBE + "/n1").then().statusCode(200).body("$", empty());
    }

    @Test
    void typingATagSuggestsTheTagsUsedInTheOrganizationOnResourcesThePersonMayRead() {
        note(ada, acme, "n1");
        note(ada, acme, "n2");
        tag(ada, acme, "n1", "garden", "gardening", "roses");
        tag(ada, acme, "n2", "Garden");

        // The most used first, then in alphabetical order, whatever the case typed.
        in(ada, acme)
                .queryParam("prefix", "  GAR")
                .get(SUGGESTIONS)
                .then()
                .statusCode(200)
                .body("$", contains("garden", "gardening"));
        in(ada, acme).get(SUGGESTIONS).then().statusCode(200).body("$", contains("garden", "gardening", "roses"));
        in(ada, acme)
                .queryParam("limit", 1)
                .get(SUGGESTIONS)
                .then()
                .statusCode(200)
                .body("$", contains("garden"));
        // What is typed is literal: no pattern.
        in(ada, acme).queryParam("prefix", "%").get(SUGGESTIONS).then().body("$", empty());
        in(ada, acme).queryParam("prefix", "_arden").get(SUGGESTIONS).then().body("$", empty());

        // Another organization has its own tags.
        in(cleo, globex).get(SUGGESTIONS).then().statusCode(200).body("$", empty());

        // A person sees the tags only of the resources they may read.
        in(bea, acme).get(SUGGESTIONS).then().statusCode(200).body("$", empty());
        in(bea, acme).get(NOTES + "/n1").then().statusCode(404);
        shareToView(ada, acme, "n1", bea);
        in(bea, acme)
                .queryParam("prefix", "gar")
                .get(SUGGESTIONS)
                .then()
                .statusCode(200)
                .body("$", contains("garden", "gardening"));
        in(bea, acme).get(NOTES + "/n1").then().statusCode(200).body("$", contains("garden", "gardening", "roses"));
        in(bea, acme).get(NOTES + "/n2").then().statusCode(404);
        // Who may only view a resource does not change its tags.
        in(bea, acme).body(List.of("mine")).put(NOTES + "/n1").then().statusCode(403);
        in(bea, acme).body(List.of("mine")).put(NOTES + "/n2").then().statusCode(404);
    }

    @Test
    void aListIsFilteredByAnyOfTheTags() {
        note(ada, acme, "n1");
        note(ada, acme, "n2");
        note(ada, acme, "n3");
        tag(ada, acme, "n1", "garden");
        tag(ada, acme, "n2", "roses", "garden");
        tag(ada, acme, "n3", "trees");

        // Through the kernel API of extensions.
        in(ada, acme)
                .queryParam("tag", "Garden")
                .get(PROBE)
                .then()
                .statusCode(200)
                .body("$", contains("n1", "n2"));
        in(ada, acme)
                .queryParam("tag", "roses", "TREES")
                .get(PROBE)
                .then()
                .statusCode(200)
                .body("$", contains("n2", "n3"));
        in(ada, acme).queryParam("tag", "ivy").get(PROBE).then().statusCode(200).body("$", empty());

        // Through the REST API, only what the person may read.
        in(ada, acme)
                .queryParam("tag", "garden", "trees")
                .get(NOTES)
                .then()
                .statusCode(200)
                .body("$", containsInAnyOrder("n1", "n2", "n3"));
        in(bea, acme)
                .queryParam("tag", "garden", "trees")
                .get(NOTES)
                .then()
                .statusCode(200)
                .body("$", empty());
        shareToView(ada, acme, "n2", bea);
        in(bea, acme)
                .queryParam("tag", "garden", "trees")
                .get(NOTES)
                .then()
                .statusCode(200)
                .body("$", contains("n2"));
        in(cleo, globex)
                .queryParam("tag", "garden")
                .get(NOTES)
                .then()
                .statusCode(200)
                .body("$", empty());
        anonymous().queryParam("tag", "garden").get(NOTES).then().statusCode(401);
    }
}
