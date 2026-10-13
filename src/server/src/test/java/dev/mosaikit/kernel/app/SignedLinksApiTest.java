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
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Signed links made by the Java code of an extension (MK-093), through {@link FilesProbe}, which calls
 * the {@code FileStorage} bean as an extension does: a link to a file or to a prefix, valid for a
 * given time within the longest validity, opened without a session.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-093")
class SignedLinksApiTest {

    static final String EXTENSION = FileStorageTest.EXTENSION;
    static final String PROBE = "/api/v1/test/files/" + EXTENSION;
    static final String PASSWORD = FileStorageTest.PASSWORD;

    private String acme;
    private String ada;
    private String bea;

    @BeforeEach
    void people() {
        acme = unique("links-api");
        asAdmin()
                .body(Map.of("slug", acme, "name", acme, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        ada = register();
        bea = register();
    }

    private String register() {
        String email = unique("links-api") + "@example.org";
        anonymous()
                .body(Map.of("organization", acme, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private RequestSpecification in(String person) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", acme);
    }

    private String stored(String person, String query, String text) {
        return in(person)
                .config(RestAssured.config()
                        .encoderConfig(EncoderConfig.encoderConfig()
                                .appendDefaultContentCharsetToContentTypeIfUndefined(false)))
                .contentType("text/plain")
                .body(text.getBytes(StandardCharsets.UTF_8))
                .post(PROBE + query)
                .then()
                .statusCode(200)
                .extract()
                .path("id");
    }

    private static RequestSpecification nobody() {
        return given().urlEncodingEnabled(false);
    }

    @Test
    void anExtensionMakesALinkToAFileValidForAGivenTime() {
        String id = stored(ada, "?name=report.txt", "the report");
        Instant before = Instant.now();
        JsonPath link = in(ada).post(PROBE + "/" + id + "/link?validFor=PT2H")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath();
        assertThat(Instant.parse(link.getString("expires")))
                .isBetween(
                        before.plus(Duration.ofHours(2)).minusSeconds(5),
                        before.plus(Duration.ofHours(2)).plusSeconds(5));
        assertThat(link.getString("path")).startsWith("/api/v1/files/signed/").contains("signature=");

        nobody().get(link.getString("path")).then().statusCode(200).body(equalTo("the report"));
        nobody().header("Range", "bytes=4-9")
                .get(link.getString("path"))
                .then()
                .statusCode(206)
                .body(equalTo("report"));

        // Beyond the longest validity, or not positive; a file the person does not read.
        in(ada).post(PROBE + "/" + id + "/link?validFor=P8D").then().statusCode(400);
        in(ada).post(PROBE + "/" + id + "/link?validFor=PT0S").then().statusCode(400);
        String roads = in(ada).body(Map.of("name", "Roads", "description", "", "visibility", "private"))
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
        String ofRoads = stored(ada, "?name=roads.txt&team=" + roads, "roads");
        in(bea).post(PROBE + "/" + ofRoads + "/link").then().statusCode(404);
    }

    @Test
    void anExtensionMakesALinkToEveryFileUnderAPrefix() {
        stored(ada, "?name=tiles/1 a.txt", "one");
        stored(ada, "?name=tiles/2.txt", "two");
        stored(ada, "?name=notes.txt", "notes");
        JsonPath link = in(bea).post(PROBE + "/links?prefix=tiles/")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath();
        String base = link.getString("base");
        String query = link.getString("query");

        nobody().get(base + "tiles/1%20a.txt?" + query).then().statusCode(200).body(equalTo("one"));
        nobody().get(base + "tiles/2.txt?" + query).then().statusCode(200).body(equalTo("two"));
        nobody().get(base + "notes.txt?" + query).then().statusCode(404);
    }
}
