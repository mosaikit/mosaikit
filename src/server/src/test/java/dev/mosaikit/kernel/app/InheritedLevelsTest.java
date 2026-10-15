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
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.RestAssured;
import io.restassured.config.EncoderConfig;
import io.restassured.path.json.JsonPath;
import io.restassured.specification.RequestSpecification;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * A level on a resource reaches the resources inside it, when their type declares it (MK-136): the
 * folders and files of the drive fixture inherit the levels of the folders above them, its notes do
 * not. Every answer of the kernel agrees: the Java API, {@code mk_kernel.allows()}, the sharing
 * endpoints, the file service and its signed links.
 *
 * <p>The tree of each test: {@code top} holds {@code sub}, which holds the file {@code doc}, with a
 * stored file attached, and the note {@code memo}; ada owns all of them.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-136")
class InheritedLevelsTest {

    static final String EXTENSION = "dev.mosaikit.test.drive";
    static final String PASSWORD = "Correct-Horse-9";
    static final String PROBE = "/api/v1/test/sharing/" + EXTENSION + "/";
    static final String API = "/api/v1/sharing/resources/" + EXTENSION + "/";
    static final String FILES = "/api/v1/files/" + EXTENSION;
    static final String TEXT = "the budget";

    private String acme;
    private String ada;
    private String bea;
    private String cid;
    private String beaId;
    private String cidId;
    private String top;
    private String sub;
    private String doc;
    private String memo;
    private String stored;

    @BeforeEach
    void tree() {
        acme = unique("inherited");
        asAdmin()
                .body(Map.of("slug", acme, "name", acme, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        ada = register();
        bea = register();
        cid = register();
        beaId = in(bea).get("/api/v1/accounts/me").path("id");
        cidId = in(cid).get("/api/v1/accounts/me").path("id");
        top = unique("top");
        sub = unique("sub");
        doc = unique("doc");
        memo = unique("memo");
        resource("folder", top, "Top", null);
        resource("folder", sub, "Sub", "folder/" + top);
        resource("file", doc, "Doc", "folder/" + sub);
        resource("note", memo, "Memo", "folder/" + sub);
        stored = in(ada).contentType("text/plain")
                .body(TEXT.getBytes(StandardCharsets.UTF_8))
                .post(FILES + "?name=doc.txt&resource=file/" + doc)
                .then()
                .statusCode(201)
                .extract()
                .path("id");
    }

    private String register() {
        String email = unique("inherited") + "@example.org";
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

    private void resource(String type, String id, String title, String parent) {
        Map<String, Object> body = new HashMap<>(Map.of("title", title, "link", "/app/drive/" + id));
        if (parent != null) {
            body.put("parent", EXTENSION + "/" + parent);
        }
        in(ada).contentType("application/json")
                .body(body)
                .put("/api/v1/test/resources/" + EXTENSION + "/" + type + "/" + id)
                .then()
                .statusCode(200);
    }

    /** Shares a resource with a person through the sharing dialog; the identifier of the grant. */
    private String share(String sharer, String type, String id, String person, String level) {
        return in(sharer)
                .contentType("application/json")
                .body(Map.of("subject", Map.of("kind", "person", "id", person), "level", level))
                .put(API + type + "/" + id + "/grants")
                .then()
                .statusCode(200)
                .extract()
                .path("id");
    }

    private static String level(RequestSpecification request, String type, String id) {
        return request.get(PROBE + type + "/" + id + "/level")
                .then()
                .statusCode(200)
                .extract()
                .path("level");
    }

    private static JsonPath allows(RequestSpecification request, String type, String id, String level) {
        return request.get(PROBE + type + "/" + id + "/allows/" + level)
                .then()
                .statusCode(200)
                .extract()
                .jsonPath();
    }

    private static JsonPath visible(RequestSpecification request, String type, String level) {
        return request.get(PROBE + type + "/visible/" + level)
                .then()
                .statusCode(200)
                .extract()
                .jsonPath();
    }

    private static RequestSpecification nobody() {
        return given().urlEncodingEnabled(false);
    }

    @Test
    void theLevelOnAResourceIsTheHighestOfItsOwnAndThoseAboveIt() {
        share(ada, "folder", top, beaId, "view");
        share(ada, "folder", sub, beaId, "edit");

        assertThat(level(in(bea), "folder", top)).isEqualTo("view");
        assertThat(level(in(bea), "folder", sub)).isEqualTo("edit");
        assertThat(level(in(bea), "file", doc)).isEqualTo("edit");
        assertThat(in(ada).queryParam("person", beaId)
                        .get(PROBE + "file/" + doc + "/level")
                        .path("level")
                        .toString())
                .isEqualTo("edit");
        assertThat(level(in(cid), "file", doc)).isEmpty();

        // A lower grant on the file itself does not lower it, a higher one above raises it.
        share(ada, "file", doc, beaId, "view");
        assertThat(level(in(bea), "file", doc)).isEqualTo("edit");
        share(ada, "folder", top, beaId, "manage");
        assertThat(level(in(bea), "file", doc)).isEqualTo("manage");

        in(bea).get(PROBE + "file/" + doc + "/require/edit").then().statusCode(204);
        in(cid).get(PROBE + "file/" + doc + "/require/view").then().statusCode(404);
    }

    @Test
    void javaApiAndSqlFunctionAgreeOnInheritedLevels() {
        share(ada, "folder", top, beaId, "edit");

        JsonPath edit = allows(in(bea), "file", doc, "edit");
        assertThat(edit.getBoolean("java")).isTrue();
        assertThat(edit.getBoolean("sql")).isTrue();
        JsonPath manage = allows(in(bea), "file", doc, "manage");
        assertThat(manage.getBoolean("java")).isFalse();
        assertThat(manage.getBoolean("sql")).isFalse();
        JsonPath none = allows(in(cid), "file", doc, "view");
        assertThat(none.getBoolean("java")).isFalse();
        assertThat(none.getBoolean("sql")).isFalse();

        // The lists of a type, as the search and the list pages of an extension filter them.
        JsonPath files = visible(in(bea), "file", "edit");
        assertThat(files.getList("java", String.class)).containsExactly(doc);
        assertThat(files.getList("sql", String.class)).containsExactly(doc);
        JsonPath folders = visible(in(bea), "folder", "view");
        assertThat(folders.getList("java", String.class)).containsExactlyInAnyOrder(top, sub);
        assertThat(folders.getList("sql", String.class)).containsExactlyInAnyOrder(top, sub);
        assertThat(visible(in(cid), "file", "view").getList("java", String.class))
                .isEmpty();
        assertThat(in(ada).queryParam("person", beaId)
                        .get(PROBE + "file/visible/edit")
                        .then()
                        .extract()
                        .jsonPath()
                        .getList("java", String.class))
                .containsExactly(doc);
    }

    @Test
    void aPersonWhoReachesAFileOnlyThroughAFolderReadsItDownloadsItAndFindsIt() {
        share(ada, "folder", top, beaId, "view");

        // The sharing dialog opens it at the inherited level.
        in(bea).get(API + "file/" + doc).then().statusCode(200).body("level", equalTo("view"));
        in(cid).get(API + "file/" + doc).then().statusCode(404);

        // The file service: its metadata, its content and the list of files.
        in(bea).get(FILES + "/" + stored).then().statusCode(200);
        in(bea).get(FILES + "/" + stored + "/content").then().statusCode(200).body(equalTo(TEXT));
        in(bea).get(FILES).then().statusCode(200).body("id", hasItem(stored));
        in(bea).get("/api/v1/test/files/" + EXTENSION + "/" + stored)
                .then()
                .statusCode(200)
                .body("content", equalTo(TEXT));
        in(cid).get(FILES + "/" + stored + "/content").then().statusCode(404);
        in(cid).get(FILES).then().statusCode(200).body("id", not(hasItem(stored)));
        // A level that does not edit does not change it.
        in(bea).delete(FILES + "/" + stored).then().statusCode(403);

        // A signed link made by the person serves it without a session.
        String url = in(bea).contentType("application/json")
                .body(Map.of("file", stored))
                .post(FILES + "/links")
                .then()
                .statusCode(201)
                .extract()
                .path("url");
        nobody().get(url).then().statusCode(200).body(equalTo(TEXT));
        in(cid).contentType("application/json")
                .body(Map.of("file", stored))
                .post(FILES + "/links")
                .then()
                .statusCode(404);
    }

    @Test
    void aLinkToAFolderOpensWhatItHolds() {
        String token = in(ada).contentType("application/json")
                .body(Map.of(
                        "level",
                        "view",
                        "expires",
                        Instant.now().plus(Duration.ofDays(1)).toString()))
                .post(API + "folder/" + top + "/links")
                .then()
                .statusCode(201)
                .extract()
                .path("token");

        assertThat(level(anonymous().header("X-Mosaikit-Link", token), "file", doc))
                .isEqualTo("view");
        assertThat(level(anonymous().header("X-Mosaikit-Link", token), "note", memo))
                .isEmpty();
        assertThat(visible(anonymous().header("X-Mosaikit-Link", token), "file", "view")
                        .getList("java", String.class))
                .containsExactly(doc);
        assertThat(level(anonymous(), "file", doc)).isEmpty();
    }

    @Test
    void removingAShareOnAFolderTakesEffectAtTheNextRequestAlsoForSignedLinks() {
        String grant = share(ada, "folder", top, beaId, "view");
        String url = in(bea).contentType("application/json")
                .body(Map.of("file", stored))
                .post(FILES + "/links")
                .then()
                .statusCode(201)
                .extract()
                .path("url");
        JsonPath prefix = in(bea).contentType("application/json")
                .body(Map.of("prefix", "doc"))
                .post(FILES + "/links")
                .then()
                .statusCode(201)
                .extract()
                .jsonPath();
        nobody().get(url).then().statusCode(200);
        nobody().get(prefix.getString("base") + "doc.txt?" + prefix.getString("query"))
                .then()
                .statusCode(200);

        in(ada).delete("/api/v1/sharing/grants/" + grant).then().statusCode(204);

        assertThat(level(in(bea), "file", doc)).isEmpty();
        assertThat(allows(in(bea), "file", doc, "view").getBoolean("sql")).isFalse();
        in(bea).get(FILES + "/" + stored + "/content").then().statusCode(404);
        in(bea).get(FILES).then().body("id", not(hasItem(stored)));
        nobody().get(url).then().statusCode(404);
        nobody().get(prefix.getString("base") + "doc.txt?" + prefix.getString("query"))
                .then()
                .statusCode(404);
    }

    @Test
    void theDialogShowsTheAccessesInheritedFromEachResourceAboveAndAManagerOfTheFolderShares() {
        share(ada, "folder", top, beaId, "manage");
        share(ada, "folder", sub, cidId, "view");

        in(bea).get(API + "file/" + doc)
                .then()
                .statusCode(200)
                .body("level", equalTo("manage"))
                .body("canShare", equalTo(true));
        JsonPath inherited = in(bea).get(API + "file/" + doc + "/inherited")
                .then()
                .statusCode(200)
                .body("$", hasSize(2))
                .extract()
                .jsonPath();
        assertThat(inherited.getString("[0].resource.id")).isEqualTo(sub);
        assertThat(inherited.getString("[0].title")).isEqualTo("Sub");
        assertThat(inherited.getList("[0].grants.subject.id", String.class)).containsExactly(cidId);
        assertThat(inherited.getList("[0].grants.level", String.class)).containsExactly("view");
        assertThat(inherited.getString("[1].resource.id")).isEqualTo(top);
        assertThat(inherited.getString("[1].resource.type")).isEqualTo("folder");
        assertThat(inherited.getString("[1].title")).isEqualTo("Top");
        assertThat(inherited.getString("[1].ownerName")).isEqualTo("P");
        assertThat(inherited.getList("[1].levels.name", String.class)).containsExactly("view", "edit", "manage");
        assertThat(inherited.getList("[1].grants.subject.id", String.class)).containsExactly(beaId);
        assertThat(inherited.getList("[1].grants.level", String.class)).containsExactly("manage");
        // The Java API names the resource above that carries each grant.
        JsonPath java = in(ada).get(PROBE + "file/" + doc + "/inherited")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath();
        assertThat(java.getList("resource.id", String.class)).containsExactly(sub, top);
        assertThat(java.getList("level", String.class)).containsExactly("view", "manage");

        // Who has manage on a folder shares what it holds, and revokes what they shared.
        in(bea).get(API + "file/" + doc + "/grants").then().statusCode(200).body("$", hasSize(0));
        String grant = share(bea, "file", doc, cidId, "edit");
        assertThat(level(in(cid), "file", doc)).isEqualTo("edit");
        in(bea).delete("/api/v1/sharing/grants/" + grant).then().statusCode(204);
        assertThat(level(in(cid), "file", doc)).isEqualTo("view");

        // Who only reads does not see who has access.
        in(cid).get(API + "file/" + doc + "/inherited").then().statusCode(403);
        in(cid).contentType("application/json")
                .body(Map.of("subject", Map.of("kind", "person", "id", beaId), "level", "view"))
                .put(API + "file/" + doc + "/grants")
                .then()
                .statusCode(403);
    }

    @Test
    void typesThatDoNotDeclareInheritanceBehaveAsBefore() {
        share(ada, "folder", top, beaId, "manage");
        share(ada, "folder", sub, beaId, "manage");

        assertThat(level(in(bea), "note", memo)).isEmpty();
        JsonPath allowed = allows(in(bea), "note", memo, "view");
        assertThat(allowed.getBoolean("java")).isFalse();
        assertThat(allowed.getBoolean("sql")).isFalse();
        assertThat(visible(in(bea), "note", "view").getList("java", String.class))
                .isEmpty();
        assertThat(visible(in(bea), "note", "view").getList("sql", String.class))
                .isEmpty();
        in(bea).get(API + "note/" + memo).then().statusCode(404);
        in(ada).get(API + "note/" + memo + "/inherited").then().statusCode(200).body("$", hasSize(0));
        assertThat(in(ada).get(PROBE + "note/" + memo + "/inherited").jsonPath().getList("$"))
                .isEqualTo(List.of());

        // The owner keeps every level.
        assertThat(level(in(ada), "note", memo)).isEqualTo("manage");
    }
}
