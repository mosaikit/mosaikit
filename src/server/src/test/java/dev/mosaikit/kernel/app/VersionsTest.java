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
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.RestAssured;
import io.restassured.config.EncoderConfig;
import io.restassured.path.json.JsonPath;
import io.restassured.specification.RequestSpecification;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The version history of resources (MK-096), on the drive fixture of {@link InheritedLevelsTest}: ada
 * owns the folder {@code top} and the file {@code doc} inside it, whose type inherits the levels of
 * the folder. The installation of the tests keeps 3 versions of a resource.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-096")
class VersionsTest {

    static final String EXTENSION = InheritedLevelsTest.EXTENSION;
    static final String PASSWORD = "Correct-Horse-9";
    static final String SHARING = "/api/v1/sharing/resources/" + EXTENSION + "/";
    static final String FILES = "/api/v1/files/" + EXTENSION;

    private String acme;
    private String ada;
    private String bea;
    private String cid;
    private String dan;
    private String adaId;
    private String beaId;
    private String cidId;
    private String top;
    private String doc;
    private String versions;

    @BeforeEach
    void tree() {
        acme = unique("versions");
        asAdmin()
                .body(Map.of("slug", acme, "name", acme, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        ada = register();
        bea = register();
        cid = register();
        dan = register();
        adaId = in(ada).get("/api/v1/accounts/me").path("id");
        beaId = in(bea).get("/api/v1/accounts/me").path("id");
        cidId = in(cid).get("/api/v1/accounts/me").path("id");
        top = unique("top");
        doc = unique("doc");
        resource("folder", top, null);
        resource("file", doc, "folder/" + top);
        versions = "/api/v1/test/versions/" + EXTENSION + "/file/" + doc;
    }

    private String register() {
        String email = unique("versions") + "@example.org";
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

    private void resource(String type, String id, String parent) {
        Map<String, Object> body = new HashMap<>(Map.of("title", id, "link", "/app/drive/" + id));
        if (parent != null) {
            body.put("parent", EXTENSION + "/" + parent);
        }
        in(ada).contentType("application/json")
                .body(body)
                .put("/api/v1/test/resources/" + EXTENSION + "/" + type + "/" + id)
                .then()
                .statusCode(200);
    }

    private void share(String type, String id, String person, String level) {
        in(ada).contentType("application/json")
                .body(Map.of("subject", Map.of("kind", "person", "id", person), "level", level))
                .put(SHARING + type + "/" + id + "/grants")
                .then()
                .statusCode(200);
    }

    /** Saves a snapshot in JSON as the person; what the save did. */
    private JsonPath save(String person, String json) {
        return in(person)
                .contentType("application/json")
                .body(Map.of("text", json, "mediaType", "application/json"))
                .post(versions)
                .then()
                .statusCode(200)
                .extract()
                .jsonPath();
    }

    private String storeFile(String text) {
        return in(ada).contentType("text/plain")
                .body(text.getBytes(StandardCharsets.UTF_8))
                .post(FILES + "?name=doc.txt&resource=file/" + doc)
                .then()
                .statusCode(201)
                .extract()
                .path("id");
    }

    @Test
    void eachSaveCreatesAVersionWithItsAuthorAndTime() {
        Instant before = Instant.now().minusSeconds(1);
        JsonPath first = save(ada, "{\"v\":1}");
        assertThat(first.getInt("version.number")).isEqualTo(1);
        assertThat(first.getString("version.author")).isEqualTo(adaId);
        assertThat(first.getString("version.mediaType")).isEqualTo("application/json");
        assertThat(first.getLong("version.size")).isEqualTo(7);
        assertThat(first.getList("pruned")).isEmpty();
        share("file", doc, beaId, "edit");
        save(bea, "{\"v\":2}");
        Instant after = Instant.now().plusSeconds(1);

        // A file stored by the extension is a version too, of its media type and size.
        String file = storeFile("the third");
        in(ada).contentType("application/json")
                .body(Map.of("file", file))
                .post(versions)
                .then()
                .statusCode(200)
                .body("version.number", equalTo(3))
                .body("version.file", equalTo(file))
                .body("version.mediaType", equalTo("text/plain"))
                .body("version.size", equalTo(9));

        JsonPath list = in(ada).get(versions).then().statusCode(200).extract().jsonPath();
        assertThat(list.getList("number", Integer.class)).containsExactly(3, 2, 1);
        assertThat(list.getList("author", String.class)).containsExactly(adaId, beaId, adaId);
        for (String created : list.getList("created", String.class)) {
            assertThat(Instant.parse(created)).isBetween(before, after);
        }
        assertThat(list.getList("restoredFrom")).containsOnlyNulls();

        String firstId = first.getString("version.id");
        in(ada).get(versions + "/" + firstId)
                .then()
                .statusCode(200)
                .body("text", equalTo("{\"v\":1}"))
                .body("mediaType", equalTo("application/json"));
        in(ada).get(versions + "/" + list.getString("id[0]"))
                .then()
                .statusCode(200)
                .body("file", equalTo(file))
                .body("text", nullValue());
    }

    @Test
    void savesAreRefusedForAFileOfAnotherExtensionOrAResourceNotRegistered() {
        String other = asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");
        in(ada).contentType("application/json")
                .body(Map.of("file", other))
                .post(versions)
                .then()
                .statusCode(400);
        in(ada).contentType("application/json")
                .body(Map.of("text", "{}", "mediaType", "application/json"))
                .post("/api/v1/test/versions/" + EXTENSION + "/file/" + unique("missing"))
                .then()
                .statusCode(404);
        in(ada).contentType("application/json")
                .body(Map.of("text", "{}", "mediaType", "application/json"))
                .post("/api/v1/test/versions/" + EXTENSION + "/undeclared/" + doc)
                .then()
                .statusCode(400);
        in(ada).get(versions).then().statusCode(200).body("$", hasSize(0));
    }

    @Test
    void aPersonWithEditRightsOpensAnEarlierVersionAndRestoresIt() {
        String firstId = save(ada, "{\"v\":1}").getString("version.id");
        save(ada, "{\"v\":2}");
        // Edit rights inherited from the folder (MK-136); cid only views; dan holds nothing.
        share("folder", top, beaId, "edit");
        share("file", doc, cidId, "view");

        in(bea).get(versions + "/" + firstId).then().statusCode(200).body("text", equalTo("{\"v\":1}"));
        JsonPath restored = in(bea).post(versions + "/" + firstId + "/restore")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath();
        assertThat(restored.getInt("version.number")).isEqualTo(3);
        assertThat(restored.getInt("version.restoredFrom")).isEqualTo(1);
        assertThat(restored.getString("version.author")).isEqualTo(beaId);
        in(bea).get(versions + "/" + restored.getString("version.id"))
                .then()
                .statusCode(200)
                .body("text", equalTo("{\"v\":1}"));
        // The history is kept: the restore is the newest version, the current one.
        in(ada).get(versions).then().statusCode(200).body("number", contains(3, 2, 1));

        // Viewing reads the history, but does not restore; no level at all: the resource is not there.
        in(cid).get(versions).then().statusCode(200).body("$", hasSize(3));
        in(cid).get(versions + "/" + firstId).then().statusCode(200);
        in(cid).post(versions + "/" + firstId + "/restore").then().statusCode(403);
        in(dan).get(versions).then().statusCode(404);
        in(dan).get(versions + "/" + firstId).then().statusCode(404);
        in(dan).post(versions + "/" + firstId + "/restore").then().statusCode(404);
        in(ada).get(versions).then().statusCode(200).body("$", hasSize(3));

        // An unknown version is not found.
        in(bea).post(versions + "/" + java.util.UUID.randomUUID() + "/restore")
                .then()
                .statusCode(404);

        // The restore is in the audit log, by bea.
        String organizationId =
                asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");
        List<Map<String, Object>> events = asAdmin()
                .queryParam("organization", organizationId)
                .queryParam("limit", 500)
                .get("/api/v1/audit-events")
                .then()
                .statusCode(200)
                .extract()
                .path("findAll { it.action == 'resource.version.restored' }");
        assertThat(events).hasSize(1);
        assertThat(events.getFirst()).containsEntry("actor", bea).containsEntry("subject", EXTENSION + "/file/" + doc);
        assertThat((String) events.getFirst().get("detail"))
                .contains("\"version\":1")
                .contains("\"restoredAs\":3");
    }

    @Test
    void theNumberOfKeptVersionsFollowsTheConfiguredLimit() {
        String file = storeFile("the first");
        in(ada).contentType("application/json")
                .body(Map.of("file", file))
                .post(versions)
                .then()
                .statusCode(200);
        save(ada, "{\"v\":2}");
        JsonPath third = save(ada, "{\"v\":3}");
        assertThat(third.getList("pruned")).isEmpty();

        // The fourth goes over the 3 of the installation: the oldest leaves, and its file stays.
        JsonPath fourth = save(ada, "{\"v\":4}");
        assertThat(fourth.getList("pruned.number", Integer.class)).containsExactly(1);
        assertThat(fourth.getString("pruned[0].file")).isEqualTo(file);
        in(ada).get(FILES + "/" + file).then().statusCode(200);
        save(ada, "{\"v\":5}");

        in(ada).get(versions).then().statusCode(200).body("number", contains(5, 4, 3));
    }
}
