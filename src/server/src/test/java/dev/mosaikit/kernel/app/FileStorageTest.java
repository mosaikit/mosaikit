// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.notNullValue;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.RestAssured;
import io.restassured.config.EncoderConfig;
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HexFormat;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The file service of the kernel through its REST API (MK-041): files of an organization and of its
 * teams, isolated from other organizations and teams even when their identifier is known, read by
 * range and with cache validators, within the size limit ({@code mosaikit.files.max-size}, 1 MB in
 * {@link TestExtensions}).
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-041")
class FileStorageTest {

    static final String EXTENSION = "dev.mosaikit.test.files";
    static final String FILES = "/api/v1/files/" + EXTENSION;
    static final String PASSWORD = "a long enough password";
    static final byte[] CONTENT = "0123456789abcdefghij".getBytes(StandardCharsets.US_ASCII);

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
        String slug = unique("files");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("files") + "@example.org";
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

    private static Response upload(RequestSpecification who, String query, String type, byte[] content) {
        return who.config(RestAssured.config()
                        .encoderConfig(EncoderConfig.encoderConfig()
                                .appendDefaultContentCharsetToContentTypeIfUndefined(false)))
                .contentType(type)
                .body(content)
                .post(FILES + query);
    }

    private static String stored(RequestSpecification who, String query, byte[] content) {
        return upload(who, query, "application/octet-stream", content)
                .then()
                .statusCode(201)
                .extract()
                .path("id");
    }

    private String team(String owner, String name) {
        return in(owner, acme)
                .body(Map.of("name", name, "description", "", "visibility", "private"))
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
    }

    private void addTo(String owner, String team, String person, String role) {
        in(owner, acme)
                .body(Map.of("role", role))
                .put("/api/v1/teams/" + team + "/members/" + person)
                .then()
                .statusCode(200);
    }

    static String sha256(byte[] content) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
    }

    @Test
    void storesReadsListsAndDeletesAFile() throws Exception {
        String adaId = in(ada, acme).get("/api/v1/accounts/me").path("id");
        String id = upload(in(ada, acme), "?name=plans/garden.png", "image/png", CONTENT)
                .then()
                .statusCode(201)
                .header("Location", containsString(FILES + "/"))
                .body("extension", equalTo(EXTENSION))
                .body("name", equalTo("plans/garden.png"))
                .body("contentType", equalTo("image/png"))
                .body("size", equalTo(CONTENT.length))
                .body("checksum", equalTo(sha256(CONTENT)))
                .body("owner", equalTo(adaId))
                .body("createdAt", notNullValue())
                .extract()
                .path("id");

        in(bea, acme).get(FILES + "/" + id).then().statusCode(200).body("name", equalTo("plans/garden.png"));
        byte[] read = in(bea, acme)
                .get(FILES + "/" + id + "/content")
                .then()
                .log()
                .ifValidationFails()
                .statusCode(200)
                .contentType("image/png")
                .header("ETag", "\"" + sha256(CONTENT) + "\"")
                .header("Last-Modified", notNullValue())
                .header("Accept-Ranges", "bytes")
                .header("Cache-Control", "private, no-cache")
                .header("Content-Disposition", "inline; filename=\"garden.png\"; filename*=UTF-8''garden.png")
                .extract()
                .asByteArray();
        assertThat(read).isEqualTo(CONTENT);
        in(bea, acme).get(FILES).then().statusCode(200).body("id", hasItem(id));

        // The content is in the store under <organization>/<extension>/<id>.
        String organizationId =
                asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");
        Path kept = Path.of("target", "files", organizationId, EXTENSION, id);
        assertThat(kept).hasBinaryContent(CONTENT);

        // Only its owner deletes it here; then it is gone, from the store too.
        in(bea, acme).delete(FILES + "/" + id).then().statusCode(403);
        in(ada, acme).delete(FILES + "/" + id).then().statusCode(204);
        in(ada, acme).get(FILES + "/" + id).then().statusCode(404);
        assertThat(Files.exists(kept)).isFalse();
    }

    @Test
    void aPersonCannotReadAFileOfAnotherOrganizationOrOfATeamTheyAreNotIn() {
        String guest = register(globex);
        String roads = team(ada, "Roads");
        addTo(ada, roads, guest, "guest");
        String ofAcme = stored(in(ada, acme), "?name=acme.bin", CONTENT);
        String ofRoads = stored(in(ada, acme), "?name=roads.bin&team=" + roads, CONTENT);

        // Another organization: not found, even with the identifier.
        for (String path : new String[] {"/" + ofAcme, "/" + ofAcme + "/content", "/" + ofRoads}) {
            in(cleo, globex).get(FILES + path).then().statusCode(404);
        }
        in(cleo, globex).delete(FILES + "/" + ofAcme).then().statusCode(404);
        in(cleo, globex).get(FILES).then().statusCode(200).body("id", not(hasItem(ofAcme)));
        // A person of another organization does not act in this one.
        in(cleo, acme).get(FILES + "/" + ofAcme).then().statusCode(403);

        // A team the person is not in: not found, and not listed.
        in(bea, acme).get(FILES + "/" + ofRoads).then().statusCode(404);
        in(bea, acme).get(FILES + "/" + ofRoads + "/content").then().statusCode(404);
        in(bea, acme).delete(FILES + "/" + ofRoads).then().statusCode(404);
        in(bea, acme).get(FILES).then().body("id", hasItem(ofAcme)).body("id", not(hasItem(ofRoads)));
        in(bea, acme).queryParam("team", roads).get(FILES).then().statusCode(404);
        upload(in(bea, acme), "?name=x.bin&team=" + roads, "application/octet-stream", CONTENT)
                .then()
                .statusCode(404);

        // Its members read it; a guest reads only the files of their teams.
        in(ada, acme).get(FILES).then().body("id", hasItem(ofAcme)).body("id", hasItem(ofRoads));
        in(guest, acme).get(FILES + "/" + ofRoads + "/content").then().statusCode(200);
        in(guest, acme).get(FILES + "/" + ofAcme).then().statusCode(404);
        in(guest, acme).get(FILES).then().statusCode(200).body("id", contains(ofRoads));
        in(guest, acme).queryParam("team", roads).get(FILES).then().body("id", contains(ofRoads));
        upload(in(guest, acme), "?name=x.bin", "application/octet-stream", CONTENT)
                .then()
                .statusCode(403);
        stored(in(guest, acme), "?name=from-guest.bin&team=" + roads, CONTENT);

        // An owner of the team deletes a file of the team.
        String byGuest =
                in(guest, acme).queryParam("team", roads).get(FILES).path("find { it.name == 'from-guest.bin' }.id");
        in(ada, acme).delete(FILES + "/" + byGuest).then().statusCode(204);
    }

    @Test
    void servesRangesAndAnswersCacheValidators() throws Exception {
        String id = stored(in(ada, acme), "?name=letters.bin", CONTENT);
        String content = FILES + "/" + id + "/content";
        String etag = "\"" + sha256(CONTENT) + "\"";

        assertThat(in(ada, acme)
                        .header("Range", "bytes=2-5")
                        .get(content)
                        .then()
                        .statusCode(206)
                        .header("Content-Range", "bytes 2-5/20")
                        .header("Content-Length", "4")
                        .extract()
                        .asString())
                .isEqualTo("2345");
        assertThat(in(ada, acme)
                        .header("Range", "bytes=-3")
                        .get(content)
                        .then()
                        .statusCode(206)
                        .extract()
                        .asString())
                .isEqualTo("hij");
        assertThat(in(ada, acme)
                        .header("Range", "bytes=18-")
                        .get(content)
                        .then()
                        .statusCode(206)
                        .extract()
                        .asString())
                .isEqualTo("ij");
        in(ada, acme)
                .header("Range", "bytes=20-")
                .get(content)
                .then()
                .statusCode(416)
                .header("Content-Range", "bytes */20");
        // Several ranges: the whole file.
        in(ada, acme).header("Range", "bytes=0-1,4-5").get(content).then().statusCode(200);

        // If-Range: the range only for the current copy.
        in(ada, acme)
                .header("Range", "bytes=2-5")
                .header("If-Range", etag)
                .get(content)
                .then()
                .statusCode(206);
        in(ada, acme)
                .header("Range", "bytes=2-5")
                .header("If-Range", "\"older\"")
                .get(content)
                .then()
                .statusCode(200)
                .header("Content-Length", "20");

        // Cache validators.
        String lastModified = in(ada, acme).get(content).header("Last-Modified");
        in(ada, acme)
                .header("If-None-Match", etag)
                .get(content)
                .then()
                .statusCode(304)
                .header("ETag", etag);
        in(ada, acme)
                .header("If-None-Match", "\"other\", " + etag)
                .get(content)
                .then()
                .statusCode(304);
        in(ada, acme).header("If-None-Match", "\"other\"").get(content).then().statusCode(200);
        in(ada, acme)
                .header("If-Modified-Since", lastModified)
                .get(content)
                .then()
                .statusCode(304);
        String before = ZonedDateTime.parse(lastModified, DateTimeFormatter.RFC_1123_DATE_TIME)
                .minusDays(1)
                .withZoneSameInstant(ZoneOffset.UTC)
                .format(DateTimeFormatter.RFC_1123_DATE_TIME);
        in(ada, acme).header("If-Modified-Since", before).get(content).then().statusCode(200);
    }

    @Test
    void refusesAFileOverTheLimitAndNamesThatAreNotValid() {
        byte[] limit = new byte[1024 * 1024];
        byte[] over = new byte[limit.length + 1];
        stored(in(ada, acme), "?name=limit.bin", limit);
        upload(in(ada, acme), "?name=over.bin", "application/octet-stream", over)
                .then()
                .statusCode(413);
        in(ada, acme).get(FILES).then().body("name", not(hasItem("over.bin")));

        for (String name : new String[] {"", "../up.bin", "a//b", "/root.bin", "dir/"}) {
            upload(in(ada, acme), "?name=" + name, "application/octet-stream", CONTENT)
                    .then()
                    .statusCode(400);
        }
        upload(in(ada, acme), "?name=x.bin", "not a type", CONTENT).then().statusCode(415);
        // An HTML page is downloaded, never shown in the page of the kernel.
        String page = upload(in(ada, acme), "?name=page.html", "text/html", CONTENT)
                .then()
                .statusCode(201)
                .extract()
                .path("id");
        in(ada, acme)
                .get(FILES + "/" + page + "/content")
                .then()
                .statusCode(200)
                .header("Content-Disposition", containsString("attachment"))
                .header("Content-Security-Policy", containsString("sandbox"));
    }

    @Test
    void attachesAFileToARegisteredResourceOfTheExtension() {
        in(ada, acme)
                .body(Map.of("title", "Summer", "link", "/app/files/albums/summer"))
                .put("/api/v1/test/resources/" + EXTENSION + "/album/summer")
                .then()
                .statusCode(200);
        upload(in(ada, acme), "?name=a.png&resource=album/summer", "image/png", CONTENT)
                .then()
                .statusCode(201)
                .body("resource", notNullValue());
        upload(in(ada, acme), "?name=a.png&resource=album/winter", "image/png", CONTENT)
                .then()
                .statusCode(400);
    }

    @Test
    void anExtensionThatIsNotActiveHasNoFiles() {
        in(ada, acme).get("/api/v1/files/dev.mosaikit.test.nothing").then().statusCode(404);
        in(ada, acme)
                .contentType("application/octet-stream")
                .body(CONTENT)
                .post("/api/v1/files/dev.mosaikit.test.nothing?name=a.bin")
                .then()
                .statusCode(404);
        anonymous().get(FILES).then().statusCode(401);
    }
}
