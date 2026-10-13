// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.startsWith;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.RestAssured;
import io.restassured.config.EncoderConfig;
import io.restassured.path.json.JsonPath;
import io.restassured.specification.RequestSpecification;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Signed, expiring links to the files of extensions (MK-093): made by a person for a file they read
 * or for a prefix of names in a scope they read, opened without a session with ranges and cache
 * validators, and refused alike, with 404, when expired, altered or outside the link. The links of
 * the tests are signed with the key derived from the master key of the test profile.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-093")
class SignedFileLinksTest {

    static final String EXTENSION = FileStorageTest.EXTENSION;
    static final String FILES = "/api/v1/files/" + EXTENSION;
    static final String PASSWORD = "a long enough password";
    static final byte[] CONTENT = "0123456789abcdefghij".getBytes(StandardCharsets.US_ASCII);

    /** The master keys of the test profile, current and former (application.properties). */
    static final byte[] MASTER = filled(0x11);

    static final byte[] FORMER_MASTER = filled(0x22);

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

    private static byte[] filled(int value) {
        byte[] key = new byte[32];
        java.util.Arrays.fill(key, (byte) value);
        return key;
    }

    private static String organization() {
        String slug = unique("links");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("links") + "@example.org";
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

    private static String stored(RequestSpecification who, String query, String type, byte[] content) {
        return who.config(RestAssured.config()
                        .encoderConfig(EncoderConfig.encoderConfig()
                                .appendDefaultContentCharsetToContentTypeIfUndefined(false)))
                .contentType(type)
                .body(content)
                .post(FILES + query)
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

    private static JsonPath link(RequestSpecification who, Map<String, ?> request) {
        return who.body(request)
                .post(FILES + "/links")
                .then()
                .statusCode(201)
                .extract()
                .jsonPath();
    }

    /** A request without a session, sending the URL as it is, already encoded. */
    private static RequestSpecification nobody() {
        return given().urlEncodingEnabled(false);
    }

    /** The signature of a link as the kernel computes it, with the key derived from a master key. */
    static String sign(byte[] master, String organization, String target, String team, long expires) throws Exception {
        Mac extract = Mac.getInstance("HmacSHA256");
        extract.init(new SecretKeySpec(new byte[32], "HmacSHA256"));
        Mac expand = Mac.getInstance("HmacSHA256");
        expand.init(new SecretKeySpec(extract.doFinal(master), "HmacSHA256"));
        expand.update("mosaikit.files.signed-links.v1".getBytes(StandardCharsets.US_ASCII));
        expand.update((byte) 1);
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(expand.doFinal(), "HmacSHA256"));
        String text = String.join(
                "\n", "mosaikit.files.link.v1", organization, EXTENSION, target, team, Long.toString(expires));
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(mac.doFinal(text.getBytes(StandardCharsets.UTF_8)));
    }

    @Test
    void aLinkToAFileServesItWithoutASessionWithRangesAndValidators() throws Exception {
        String id = stored(in(ada, acme), "?name=plans/garden.png", "image/png", CONTENT);
        Instant before = Instant.now();
        JsonPath made = link(in(ada, acme), Map.of("file", id));
        String url = made.getString("url");
        assertThat(url).contains("/api/v1/files/signed/").contains("/" + EXTENSION + "/" + id + "?expires=");
        assertThat(url).contains("&signature=");
        Instant expires = Instant.parse(made.getString("expires"));
        assertThat(expires)
                .isBetween(
                        before.plus(Duration.ofDays(7)).minusSeconds(5),
                        before.plus(Duration.ofDays(7)).plusSeconds(5));

        String etag = "\"" + FileStorageTest.sha256(CONTENT) + "\"";
        byte[] body = nobody().get(url)
                .then()
                .statusCode(200)
                .contentType(startsWith("image/png"))
                .header("ETag", etag)
                .header("Accept-Ranges", "bytes")
                .header("Last-Modified", notNullValue())
                .header("X-Content-Type-Options", "nosniff")
                .extract()
                .asByteArray();
        assertThat(body).isEqualTo(CONTENT);
        nobody().header("Range", "bytes=2-5")
                .get(url)
                .then()
                .statusCode(206)
                .header("Content-Range", "bytes 2-5/20")
                .body(equalTo("2345"));
        nobody().header("If-None-Match", etag).get(url).then().statusCode(304);

        // The same file stays unreachable without a link.
        given().get(FILES + "/" + id + "/content").then().statusCode(401);

        // Making the link is audited; its use once in the hour, not at every download.
        List<Map<String, Object>> events = asAdmin()
                .get("/api/v1/audit-events?limit=500")
                .then()
                .extract()
                .path("findAll { it.subject == '" + id + "' }");
        assertThat(events)
                .extracting(event -> event.get("action"))
                .containsExactlyInAnyOrder("file.stored", "file.link.created", "file.link.used");
        String signature = url.substring(url.indexOf("signature=") + "signature=".length());
        assertThat(events.toString()).doesNotContain(signature);
    }

    @Test
    void aLinkToAPrefixCoversEveryFileUnderItAndNothingElse() {
        stored(in(ada, acme), "?name=tiles/3/4/2.png", "image/png", "two".getBytes(StandardCharsets.US_ASCII));
        stored(in(ada, acme), "?name=tiles/3/4/5.png", "image/png", "five".getBytes(StandardCharsets.US_ASCII));
        String outside = stored(in(ada, acme), "?name=secret.png", "image/png", CONTENT);
        String roads = team(ada, "Roads");
        stored(in(ada, acme), "?name=tiles/9.png&team=" + roads, "image/png", CONTENT);

        JsonPath made = link(in(bea, acme), Map.of("prefix", "tiles/"));
        String base = made.getString("base");
        String query = made.getString("query");
        assertThat(base).endsWith("/" + EXTENSION + "/named/");
        assertThat(query).contains("prefix=tiles%2F").contains("&expires=").contains("&signature=");

        nobody().get(base + "tiles/3/4/2.png?" + query).then().statusCode(200).body(equalTo("two"));
        nobody().get(base + "tiles/3/4/5.png?" + query).then().statusCode(200).body(equalTo("five"));
        // Not under the prefix, not of the scope of the link, not there: all the same 404.
        nobody().get(base + "secret.png?" + query).then().statusCode(404);
        nobody().get(base + "tiles/9.png?" + query).then().statusCode(404);
        nobody().get(base + "tiles/none.png?" + query).then().statusCode(404);
        nobody().get(base.replace("/named/", "/") + outside + "?" + query)
                .then()
                .statusCode(404);

        // A link to the prefix of a team covers its files, for its people only.
        JsonPath ofRoads = link(in(ada, acme), Map.of("prefix", "tiles/", "team", roads));
        nobody().get(ofRoads.getString("base") + "tiles/9.png?" + ofRoads.getString("query"))
                .then()
                .statusCode(200);
        nobody().get(ofRoads.getString("base") + "tiles/3/4/2.png?" + ofRoads.getString("query"))
                .then()
                .statusCode(404);
        in(bea, acme)
                .body(Map.of("prefix", "tiles/", "team", roads))
                .post(FILES + "/links")
                .then()
                .statusCode(404);

        // An empty prefix covers every file of the scope.
        JsonPath all = link(in(bea, acme), Map.of("prefix", ""));
        nobody().get(all.getString("base") + "secret.png?" + all.getString("query"))
                .then()
                .statusCode(200);
    }

    @Test
    void anExpiredOrAlteredLinkIsRefusedAlike() throws Exception {
        String id = stored(in(ada, acme), "?name=report.pdf", "application/pdf", CONTENT);
        String other = stored(in(ada, acme), "?name=other.pdf", "application/pdf", CONTENT);
        String url = link(in(ada, acme), Map.of("file", id)).getString("url");
        nobody().get(url).then().statusCode(200);

        String path = url.substring(0, url.indexOf('?'));
        String organization = path.split("/")[path.split("/").length - 3];
        String expires = url.replaceAll(".*expires=(\\d+).*", "$1");
        String signature = url.replaceAll(".*signature=([\\w-]+).*", "$1");
        String flipped = (signature.charAt(0) == 'A' ? "B" : "A") + signature.substring(1);

        // Another signature, another expiry, another file, another organization, or none at all.
        nobody().get(path + "?expires=" + expires + "&signature=" + flipped)
                .then()
                .statusCode(404);
        nobody().get(path + "?expires=" + (Long.parseLong(expires) + 1) + "&signature=" + signature)
                .then()
                .statusCode(404);
        nobody().get(path.replace(id, other) + "?expires=" + expires + "&signature=" + signature)
                .then()
                .statusCode(404);
        nobody().get(path.replace(organization, UUID.randomUUID().toString()) + "?expires=" + expires + "&signature="
                        + signature)
                .then()
                .statusCode(404);
        nobody().get(path).then().statusCode(404);
        nobody().get(path + "?expires=" + expires + "&signature=not.base64!")
                .then()
                .statusCode(404);

        // Well signed but expired.
        long past = Instant.now().minusSeconds(60).getEpochSecond();
        String expired = sign(MASTER, organization, "file:" + id, "", past);
        nobody().get(path + "?expires=" + past + "&signature=" + expired).then().statusCode(404);
        long future = Instant.now().plusSeconds(600).getEpochSecond();
        nobody().get(path + "?expires=" + future + "&signature=" + sign(MASTER, organization, "file:" + id, "", future))
                .then()
                .statusCode(200);

        // A link signed with a former key keeps working until it expires (rotation).
        nobody().get(path + "?expires=" + future + "&signature="
                        + sign(FORMER_MASTER, organization, "file:" + id, "", future))
                .then()
                .statusCode(200);
        nobody().get(path + "?expires=" + future + "&signature="
                        + sign(filled(0x33), organization, "file:" + id, "", future))
                .then()
                .statusCode(404);

        // A deleted file is gone for its links too.
        in(ada, acme).delete(FILES + "/" + id).then().statusCode(204);
        nobody().get(url).then().statusCode(404);
    }

    @Test
    void onlyWhoReadsTheFilesMakesALinkWithinTheLongestValidity() {
        String id = stored(in(ada, acme), "?name=plans/house.png", "image/png", CONTENT);
        String roads = team(ada, "Roads");
        String ofRoads = stored(in(ada, acme), "?name=roads.png&team=" + roads, "image/png", CONTENT);

        // Another organization, another team: the file does not exist for them.
        in(cleo, globex).body(Map.of("file", id)).post(FILES + "/links").then().statusCode(404);
        in(bea, acme)
                .body(Map.of("file", ofRoads))
                .post(FILES + "/links")
                .then()
                .statusCode(404);
        given().contentType("application/json")
                .body(Map.of("file", id))
                .post(FILES + "/links")
                .then()
                .statusCode(401);

        // A file or a prefix, not both; a team only with a prefix; an expiry in the next 7 days.
        in(ada, acme)
                .body(Map.of("file", id, "prefix", "plans/"))
                .post(FILES + "/links")
                .then()
                .statusCode(400);
        in(ada, acme).body(Map.of()).post(FILES + "/links").then().statusCode(400);
        in(ada, acme)
                .body(Map.of("file", id, "team", roads))
                .post(FILES + "/links")
                .then()
                .statusCode(400);
        in(ada, acme)
                .body(Map.of(
                        "file",
                        id,
                        "expires",
                        Instant.now().plus(Duration.ofDays(8)).toString()))
                .post(FILES + "/links")
                .then()
                .statusCode(400)
                .body(containsString("link-max-validity"));
        in(ada, acme)
                .body(Map.of(
                        "file", id, "expires", Instant.now().minusSeconds(1).toString()))
                .post(FILES + "/links")
                .then()
                .statusCode(400);
        in(ada, acme)
                .body(Map.of("prefix", "../x"))
                .post(FILES + "/links")
                .then()
                .statusCode(400);
        Instant soon = Instant.now().plus(Duration.ofHours(1));
        JsonPath made = link(in(ada, acme), Map.of("file", id, "expires", soon.toString()));
        assertThat(Instant.parse(made.getString("expires")))
                .isEqualTo(soon.truncatedTo(java.time.temporal.ChronoUnit.SECONDS));
    }
}
