// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.RestAssured;
import io.restassured.config.EncoderConfig;
import io.restassured.path.json.JsonPath;
import io.restassured.specification.RequestSpecification;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * A signed link made by a person carries their rights (MK-093 on MK-055): it serves a file attached to
 * a resource only while they hold a level on the resource, so a link to a prefix never hands out the
 * files of resources they do not read, and a revoked share stops their links. Files without a
 * resource, such as tiles, are served as before, and a link made without a person covers its scope.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-093")
@Tag("MK-055")
class SignedLinksFollowSharingTest {

    static final String EXTENSION = FileStorageTest.EXTENSION;
    static final String FILES = FileStorageTest.FILES;
    static final String SHARING = "/api/v1/sharing/resources/" + EXTENSION + "/album/";
    static final String PASSWORD = FileStorageTest.PASSWORD;

    private String acme;
    private String ada;
    private String bea;
    private String shared;
    private String unshared;
    private String ofShared;
    private String ofUnshared;
    private String tile;

    @BeforeEach
    void files() {
        acme = unique("links-sharing");
        asAdmin()
                .body(Map.of("slug", acme, "name", acme, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        ada = register();
        bea = register();
        shared = album();
        unshared = album();
        ofShared = stored("?name=tiles/shared.png&resource=album/" + shared, "shared");
        ofUnshared = stored("?name=tiles/unshared.png&resource=album/" + unshared, "unshared");
        tile = stored("?name=tiles/3/4/2.png", "tile");
    }

    private String register() {
        String email = unique("links-sharing") + "@example.org";
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

    private String album() {
        String id = unique("album");
        in(ada).contentType("application/json")
                .body(Map.of("title", "Album", "link", "/app/files/albums/" + id))
                .put("/api/v1/test/resources/" + EXTENSION + "/album/" + id)
                .then()
                .statusCode(200);
        return id;
    }

    private String stored(String query, String text) {
        return in(ada).contentType("image/png")
                .body(text.getBytes(StandardCharsets.UTF_8))
                .post(FILES + query)
                .then()
                .statusCode(201)
                .extract()
                .path("id");
    }

    /** Shares the shared album with bea to view; the identifier of the grant. */
    private String shareWithBea() {
        String beaId = in(bea).get("/api/v1/accounts/me").path("id");
        return in(ada).contentType("application/json")
                .body(Map.of("subject", Map.of("kind", "person", "id", beaId), "level", "view"))
                .put(SHARING + shared + "/grants")
                .then()
                .statusCode(200)
                .extract()
                .path("id");
    }

    private JsonPath link(String person, Map<String, ?> request) {
        return in(person)
                .contentType("application/json")
                .body(request)
                .post(FILES + "/links")
                .then()
                .statusCode(201)
                .extract()
                .jsonPath();
    }

    private static RequestSpecification nobody() {
        return given().urlEncodingEnabled(false);
    }

    @Test
    void aLinkToAPrefixServesOnlyTheFilesOfResourcesItsCreatorReads() {
        shareWithBea();
        JsonPath made = link(bea, Map.of("prefix", "tiles/"));
        String base = made.getString("base");
        String query = made.getString("query");
        assertThat(query).contains("&creator=");

        nobody().get(base + "tiles/shared.png?" + query).then().statusCode(200).body(equalTo("shared"));
        nobody().get(base + "tiles/unshared.png?" + query).then().statusCode(404);
        nobody().get(base + "tiles/3/4/2.png?" + query).then().statusCode(200).body(equalTo("tile"));

        // The creator cannot be dropped or changed: the link no longer verifies.
        String without = query.replaceAll("&creator=[^&]*", "");
        nobody().get(base + "tiles/3/4/2.png?" + without).then().statusCode(404);
        String adaId = in(ada).get("/api/v1/accounts/me").path("id");
        String asAda = query.replaceAll("creator=[^&]*", "creator=" + adaId);
        nobody().get(base + "tiles/unshared.png?" + asAda).then().statusCode(404);

        // The owner of both albums hands out both.
        JsonPath ofAda = link(ada, Map.of("prefix", "tiles/"));
        nobody().get(ofAda.getString("base") + "tiles/unshared.png?" + ofAda.getString("query"))
                .then()
                .statusCode(200);
    }

    @Test
    void aRevokedShareStopsTheLinksOfThePersonItWasSharedWith() {
        String grant = shareWithBea();
        String url = link(bea, Map.of("file", ofShared)).getString("url");
        JsonPath prefix = link(bea, Map.of("prefix", "tiles/"));
        String tileLink = link(bea, Map.of("file", tile)).getString("url");
        nobody().get(url).then().statusCode(200);

        in(ada).delete("/api/v1/sharing/grants/" + grant).then().statusCode(204);

        nobody().get(url).then().statusCode(404);
        nobody().get(prefix.getString("base") + "tiles/shared.png?" + prefix.getString("query"))
                .then()
                .statusCode(404);
        // Files without a resource are served as before.
        nobody().get(prefix.getString("base") + "tiles/3/4/2.png?" + prefix.getString("query"))
                .then()
                .statusCode(200);
        nobody().get(tileLink).then().statusCode(200);
        // And no link to the file can be made any more.
        in(bea).contentType("application/json")
                .body(Map.of("file", ofShared))
                .post(FILES + "/links")
                .then()
                .statusCode(404);
    }

    @Test
    void aLinkMadeWithoutAPersonCoversItsWholeScope() throws Exception {
        String organization =
                asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");
        long expires = Instant.now().plusSeconds(600).getEpochSecond();
        String signature =
                SignedFileLinksTest.sign(SignedFileLinksTest.MASTER, organization, "prefix:tiles/", "", expires);
        String base = "/api/v1/files/signed/" + organization + "/" + EXTENSION + "/named/";
        String query = "prefix=tiles%2F&expires=" + expires + "&signature=" + signature;

        nobody().get(base + "tiles/shared.png?" + query).then().statusCode(200).body(equalTo("shared"));
        nobody().get(base + "tiles/unshared.png?" + query)
                .then()
                .statusCode(200)
                .body(equalTo("unshared"));
        nobody().get(base + "tiles/3/4/2.png?" + query).then().statusCode(200).body(equalTo("tile"));
        assertThat(ofUnshared).isNotBlank();
    }
}
