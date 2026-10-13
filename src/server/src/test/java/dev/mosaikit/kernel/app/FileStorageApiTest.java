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
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.RestAssured;
import io.restassured.config.EncoderConfig;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The Java API of the file service (MK-041), through {@link FilesProbe}, which calls the {@code
 * FileStorage} bean as the Java code of an extension does: it stores and reads files without any
 * setting of the store, and the bean applies the same rights as the REST API.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-041")
class FileStorageApiTest {

    static final String EXTENSION = FileStorageTest.EXTENSION;
    static final String PROBE = "/api/v1/test/files/" + EXTENSION;
    static final String PASSWORD = FileStorageTest.PASSWORD;
    static final String TEXT = "Rome, 12 tiles, 3 layers";

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
        String slug = unique("files-api");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("files-api") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD)
                .header("X-Mosaikit-Organization", organization)
                .config(RestAssured.config()
                        .encoderConfig(EncoderConfig.encoderConfig()
                                .appendDefaultContentCharsetToContentTypeIfUndefined(false)));
    }

    private static Response store(RequestSpecification who, String extension, String query) {
        return who.contentType("text/plain")
                .body(TEXT.getBytes(StandardCharsets.UTF_8))
                .post("/api/v1/test/files/" + extension + query);
    }

    private static String stored(RequestSpecification who, String query) {
        return store(who, EXTENSION, query).then().statusCode(200).extract().path("id");
    }

    @Test
    void anExtensionStoresAndReadsAFileWithoutTheCredentialsOfTheStore() throws Exception {
        String adaId = in(ada, acme).get("/api/v1/accounts/me").path("id");
        String id = store(in(ada, acme), EXTENSION, "?name=notes/rome.txt")
                .then()
                .statusCode(200)
                .body("extension", equalTo(EXTENSION))
                .body("name", equalTo("notes/rome.txt"))
                .body("contentType", equalTo("text/plain"))
                .body("size", equalTo(TEXT.length()))
                .body("checksum", equalTo(FileStorageTest.sha256(TEXT.getBytes(StandardCharsets.UTF_8))))
                .body("owner", equalTo(adaId))
                .extract()
                .path("id");

        // Read back through the bean, by another person of the organization.
        in(bea, acme)
                .get(PROBE + "/" + id)
                .then()
                .statusCode(200)
                .body("file.id", equalTo(id))
                .body("content", equalTo(TEXT));
        in(bea, acme).get(PROBE + "/" + id + "/metadata").then().statusCode(200);
        in(bea, acme).get(PROBE).then().statusCode(200).body("id", hasItem(id));

        // The same file through the REST API, and in the store of the installation.
        assertThat(in(bea, acme)
                        .get(FileStorageTest.FILES + "/" + id + "/content")
                        .then()
                        .statusCode(200)
                        .extract()
                        .asString())
                .isEqualTo(TEXT);
        String organizationId =
                asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");
        assertThat(Path.of("target", "files", organizationId, EXTENSION, id)).hasContent(TEXT);

        // Attached to a registered resource of the extension.
        in(ada, acme)
                .contentType("application/json")
                .body(Map.of("title", "Rome", "link", "/app/files/albums/rome"))
                .put("/api/v1/test/resources/" + EXTENSION + "/album/rome")
                .then()
                .statusCode(200);
        store(in(ada, acme), EXTENSION, "?name=cover.txt&resource=album/rome")
                .then()
                .statusCode(200)
                .body("resource.type", equalTo("album"))
                .body("resource.id", equalTo("rome"));

        // Deleted by the person who stored it, and gone.
        in(bea, acme).delete(PROBE + "/" + id).then().statusCode(403);
        in(ada, acme).delete(PROBE + "/" + id).then().statusCode(204);
        in(ada, acme).get(PROBE + "/" + id).then().statusCode(404);
        in(ada, acme).get(PROBE + "/" + id + "/metadata").then().statusCode(404);
    }

    @Test
    void aPersonCannotReadThroughTheBeanAFileOfAnotherOrganizationOrOfATeamTheyAreNotIn() {
        String guest = register(globex);
        String roads = in(ada, acme)
                .contentType("application/json")
                .body(Map.of("name", "Roads", "description", "", "visibility", "private"))
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
        in(ada, acme)
                .contentType("application/json")
                .body(Map.of("role", "guest"))
                .put("/api/v1/teams/" + roads + "/members/" + guest)
                .then()
                .statusCode(200);
        String ofAcme = stored(in(ada, acme), "?name=acme.txt");
        String ofRoads = stored(in(ada, acme), "?name=roads.txt&team=" + roads);

        // Another organization: not found, even with the identifier.
        in(cleo, globex).get(PROBE + "/" + ofAcme).then().statusCode(404);
        in(cleo, globex).get(PROBE + "/" + ofAcme + "/metadata").then().statusCode(404);
        in(cleo, globex).delete(PROBE + "/" + ofAcme).then().statusCode(404);
        in(cleo, globex).get(PROBE).then().statusCode(200).body("id", not(hasItem(ofAcme)));

        // A team the person is not in: not found.
        in(bea, acme).get(PROBE + "/" + ofRoads).then().statusCode(404);
        in(bea, acme).get(PROBE + "/" + ofRoads + "/metadata").then().statusCode(404);
        in(bea, acme).get(PROBE).then().body("id", hasItem(ofAcme)).body("id", not(hasItem(ofRoads)));
        in(bea, acme).queryParam("team", roads).get(PROBE).then().statusCode(404);
        store(in(bea, acme), EXTENSION, "?name=x.txt&team=" + roads).then().statusCode(404);

        // The members of the team read it. Guests never reach the Java code of extensions (their
        // requests to extension backends are refused); FileStorageTest shows what they read.
        in(ada, acme).get(PROBE + "/" + ofRoads).then().statusCode(200).body("content", equalTo(TEXT));
        in(ada, acme).queryParam("team", roads).get(PROBE).then().body("id", contains(ofRoads));
        in(guest, acme).get(PROBE + "/" + ofRoads).then().statusCode(403);
    }

    @Test
    void onlyAnActiveExtensionUsesTheService() {
        store(in(ada, acme), "dev.mosaikit.test.nothing", "?name=a.txt").then().statusCode(400);
        in(ada, acme).get("/api/v1/test/files/dev.mosaikit.test.nothing").then().statusCode(400);
        store(in(ada, acme), EXTENSION, "?name=../a.txt").then().statusCode(400);
    }
}
