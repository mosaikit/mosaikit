// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.not;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.RestAssured;
import io.restassured.config.EncoderConfig;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * A file attached to a registered resource follows the sharing of the resource (MK-041 on MK-055), in
 * the REST API and in the {@code FileStorage} bean ({@link FilesProbe}) alike: a member without a
 * level on the resource does not find it, a level reads it, a level that edits replaces and deletes
 * it. Files without a resource keep the rules of the organization and its teams.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-041")
@Tag("MK-055")
class FilesFollowSharingTest {

    static final String EXTENSION = FileStorageTest.EXTENSION;
    static final String FILES = FileStorageTest.FILES;
    static final String PROBE = "/api/v1/test/files/" + EXTENSION;
    static final String SHARING = "/api/v1/sharing/resources/" + EXTENSION + "/album/";
    static final String PASSWORD = FileStorageTest.PASSWORD;
    static final String TEXT = "Rome, 12 tiles, 3 layers";

    private String acme;
    private String ada;
    private String bea;
    private String cleo;
    private String album;

    @BeforeEach
    void people() {
        acme = unique("files-sharing");
        asAdmin()
                .body(Map.of("slug", acme, "name", acme, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        ada = register();
        bea = register();
        cleo = register();
        album = unique("album");
        in(ada).contentType("application/json")
                .body(Map.of("title", "Rome", "link", "/app/files/albums/rome"))
                .put("/api/v1/test/resources/" + EXTENSION + "/album/" + album)
                .then()
                .statusCode(200);
    }

    private String register() {
        String email = unique("files-sharing") + "@example.org";
        anonymous()
                .body(Map.of("organization", acme, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private RequestSpecification in(String person) {
        return as(person, PASSWORD)
                .header("X-Mosaikit-Organization", acme)
                .config(RestAssured.config()
                        .encoderConfig(EncoderConfig.encoderConfig()
                                .appendDefaultContentCharsetToContentTypeIfUndefined(false)));
    }

    private Response upload(String person, String query) {
        return in(person)
                .contentType("text/plain")
                .body(TEXT.getBytes(StandardCharsets.UTF_8))
                .post(FILES + query);
    }

    private String stored(String person, String query) {
        return upload(person, query).then().statusCode(201).extract().path("id");
    }

    private void grant(String person, String level) {
        String id = in(person).get("/api/v1/accounts/me").path("id");
        in(ada).contentType("application/json")
                .body(Map.of("subject", Map.of("kind", "person", "id", id), "level", level))
                .put(SHARING + album + "/grants")
                .then()
                .statusCode(200);
    }

    private Response link(String person, String file) {
        return in(person)
                .contentType("application/json")
                .body(Map.of("file", file))
                .post(FILES + "/links");
    }

    @Test
    void aMemberWithoutALevelDoesNotFindTheFilesOfTheResource() {
        String file = stored(ada, "?name=cover.txt&resource=album/" + album);
        String plain = stored(ada, "?name=plain.txt");

        // REST: not found, and not listed; a file without a resource as before.
        in(bea).get(FILES + "/" + file).then().statusCode(404);
        in(bea).get(FILES + "/" + file + "/content").then().statusCode(404);
        in(bea).delete(FILES + "/" + file).then().statusCode(404);
        link(bea, file).then().statusCode(404);
        in(bea).get(FILES).then().statusCode(200).body("id", hasItem(plain)).body("id", not(hasItem(file)));
        in(bea).get(FILES + "/" + plain + "/content").then().statusCode(200);
        in(bea).delete(FILES + "/" + plain).then().statusCode(403);

        // The bean answers the same.
        in(bea).get(PROBE + "/" + file).then().statusCode(404);
        in(bea).get(PROBE + "/" + file + "/metadata").then().statusCode(404);
        in(bea).delete(PROBE + "/" + file).then().statusCode(404);
        in(bea).post(PROBE + "/" + file + "/link").then().statusCode(404);
        in(bea).get(PROBE).then().statusCode(200).body("id", hasItem(plain)).body("id", not(hasItem(file)));

        // Nor attaches files to it.
        upload(bea, "?name=x.txt&resource=album/" + album).then().statusCode(400);

        // The owner of the resource, who stored it, still reads and lists it.
        in(ada).get(FILES).then().body("id", hasItems(file, plain));
        in(ada).get(PROBE + "/" + file).then().statusCode(200).body("content", equalTo(TEXT));
    }

    @Test
    void aLevelToViewReadsTheFilesOfTheResourceButDoesNotChangeThem() {
        String file = stored(ada, "?name=cover.txt&resource=album/" + album);
        grant(bea, "view");

        in(bea).get(FILES + "/" + file).then().statusCode(200);
        in(bea).get(FILES + "/" + file + "/content").then().statusCode(200).body(equalTo(TEXT));
        in(bea).get(FILES).then().body("id", hasItem(file));
        in(bea).get(PROBE + "/" + file).then().statusCode(200).body("content", equalTo(TEXT));
        in(bea).get(PROBE).then().body("id", hasItem(file));
        link(bea, file).then().statusCode(201);
        in(bea).post(PROBE + "/" + file + "/link").then().statusCode(200);

        // Neither replaces nor deletes it.
        in(bea).delete(FILES + "/" + file).then().statusCode(403);
        in(bea).delete(PROBE + "/" + file).then().statusCode(403);
        upload(bea, "?name=cover.txt&resource=album/" + album).then().statusCode(403);
        in(bea).contentType("text/plain")
                .body(TEXT.getBytes(StandardCharsets.UTF_8))
                .post(PROBE + "?name=cover.txt&resource=album/" + album)
                .then()
                .statusCode(403);
        in(ada).get(FILES + "/" + file).then().statusCode(200);
    }

    @Test
    void aLevelThatEditsReplacesAndDeletesTheFilesOfTheResource() {
        String first = stored(ada, "?name=cover.txt&resource=album/" + album);
        String second = stored(ada, "?name=back.txt&resource=album/" + album);
        grant(cleo, "edit");

        // Replaces the cover through the REST API: deletes it and stores the new one.
        in(cleo).delete(FILES + "/" + first).then().statusCode(204);
        String replaced = stored(cleo, "?name=cover.txt&resource=album/" + album);
        in(ada).get(FILES + "/" + first).then().statusCode(404);
        in(ada).get(FILES + "/" + replaced + "/content").then().statusCode(200).body(equalTo(TEXT));

        // And through the bean.
        in(cleo).delete(PROBE + "/" + second).then().statusCode(204);
        in(cleo).contentType("text/plain")
                .body(TEXT.getBytes(StandardCharsets.UTF_8))
                .post(PROBE + "?name=back.txt&resource=album/" + album)
                .then()
                .statusCode(200);
        in(ada).get(FILES + "/" + second).then().statusCode(404);

        // A file that ada stored, without a resource, stays hers to delete.
        String plain = stored(ada, "?name=plain.txt");
        in(cleo).delete(FILES + "/" + plain).then().statusCode(403);
        in(cleo).delete(PROBE + "/" + plain).then().statusCode(403);
    }

    @Test
    void theSharingOfTheResourceReachesBeyondTheTeamOfTheFile() {
        String roads = in(ada).contentType("application/json")
                .body(Map.of("name", "Roads", "description", "", "visibility", "private"))
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
        String file = stored(ada, "?name=cover.txt&team=" + roads + "&resource=album/" + album);
        String ofTeam = stored(ada, "?name=roads.txt&team=" + roads);

        in(bea).get(FILES + "/" + file).then().statusCode(404);
        grant(bea, "view");
        in(bea).get(FILES + "/" + file + "/content").then().statusCode(200).body(equalTo(TEXT));
        in(bea).get(PROBE + "/" + file).then().statusCode(200);
        in(bea).get(FILES).then().body("id", hasItem(file)).body("id", not(hasItem(ofTeam)));
        // A file of the team without a resource stays for the team.
        in(bea).get(FILES + "/" + ofTeam).then().statusCode(404);
    }
}
