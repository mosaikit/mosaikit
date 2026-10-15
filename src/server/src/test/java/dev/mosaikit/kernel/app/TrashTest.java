// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.fail;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;

import dev.mosaikit.kernel.api.events.PlatformEvent;
import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.core.events.PlatformEventDispatcher;
import dev.mosaikit.kernel.core.resources.KernelTrash;
import dev.mosaikit.kernel.core.resources.TrashPurges;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.path.json.JsonPath;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.function.Supplier;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The trash of the registered resources (MK-095), on the drive fixture of {@link InheritedLevelsTest}:
 * {@code top} holds the folder {@code sub}, which holds the file {@code doc} and the note {@code memo};
 * ada owns all of them, bea is a member, cleo an administrator of the organization. The extension
 * moves resources to the trash through the {@code Trash} bean ({@link TrashProbe}), as a file manager
 * does when a person deletes them.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-095")
class TrashTest {

    static final String EXTENSION = InheritedLevelsTest.EXTENSION;
    static final String PASSWORD = "Correct-Horse-9";
    static final String PROBE = "/api/v1/test/trash/" + EXTENSION + "/";
    static final String RESOURCES = "/api/v1/test/resources/" + EXTENSION + "/";
    static final String LEVELS = "/api/v1/test/sharing/" + EXTENSION + "/";
    static final String SHARING = "/api/v1/sharing/resources/" + EXTENSION + "/";
    static final String TRASH = "/api/v1/trash";
    private static final Duration WAIT = Duration.ofSeconds(30);

    @Inject
    TrashPurges purges;

    @Inject
    PlatformEventDispatcher dispatcher;

    @Inject
    TrashProbe.Told told;

    @Inject
    AgroalDataSource dataSource;

    private String acme;
    private String ada;
    private String bea;
    private String cleo;
    private String beaId;
    private String top;
    private String sub;
    private String doc;
    private String memo;

    @BeforeEach
    void tree() {
        acme = unique("trash");
        asAdmin()
                .body(Map.of("slug", acme, "name", acme, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        ada = register();
        bea = register();
        cleo = register();
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", acme, cleo)
                .then()
                .statusCode(200);
        beaId = in(bea).get("/api/v1/accounts/me").path("id");
        top = unique("top");
        sub = unique("sub");
        doc = unique("doc");
        memo = unique("memo");
        resource("folder", top, "Top", null).then().statusCode(200);
        resource("folder", sub, "Sub", "folder/" + top).then().statusCode(200);
        resource("file", doc, "Doc", "folder/" + sub).then().statusCode(200);
        resource("note", memo, "Memo", "folder/" + sub).then().statusCode(200);
    }

    private String register() {
        String email = unique("trash") + "@example.org";
        anonymous()
                .body(Map.of("organization", acme, "email", email, "displayName", "Pat " + email, "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private RequestSpecification in(String person) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", acme);
    }

    private io.restassured.response.Response resource(String type, String id, String title, String parent) {
        Map<String, Object> body = new HashMap<>(Map.of("title", title, "link", "/app/drive/" + id));
        if (parent != null) {
            body.put("parent", EXTENSION + "/" + parent);
        }
        return in(ada).body(body).put(RESOURCES + type + "/" + id);
    }

    /** The extension moves a resource to the trash; what went there. */
    private List<String> trash(String type, String id) {
        return in(ada).post(PROBE + type + "/" + id)
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getList("", String.class);
    }

    private boolean inTrash(String type, String id) {
        return in(ada).get(PROBE + type + "/" + id)
                .then()
                .statusCode(200)
                .extract()
                .as(Boolean.class);
    }

    private static JsonPath list(RequestSpecification request) {
        return request.get(TRASH).then().statusCode(200).extract().jsonPath();
    }

    /** The entry of the trash of a resource that was trashed, as its owner sees it. */
    private Map<String, Object> entry(String id) {
        List<Map<String, Object>> found = list(in(ada)).getList("findAll { it.resourceId == '" + id + "' }");
        assertThat(found).hasSize(1);
        return found.getFirst();
    }

    private String share(String type, String id, String level) {
        return in(ada).body(Map.of("subject", Map.of("kind", "person", "id", beaId), "level", level))
                .put(SHARING + type + "/" + id + "/grants")
                .then()
                .statusCode(200)
                .extract()
                .path("id");
    }

    private String level(String type, String id) {
        return in(bea).get(LEVELS + type + "/" + id + "/level")
                .then()
                .statusCode(200)
                .extract()
                .path("level");
    }

    private JsonPath allows(String type, String id, String level) {
        return in(bea).get(LEVELS + type + "/" + id + "/allows/" + level)
                .then()
                .statusCode(200)
                .extract()
                .jsonPath();
    }

    private static int open(String token) {
        return anonymous()
                .body(Map.of("token", token))
                .post("/api/v1/sharing/links/open")
                .statusCode();
    }

    private List<Map<String, Object>> audit(String prefix) {
        String organizationId =
                asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");
        return asAdmin()
                .queryParam("organization", organizationId)
                .queryParam("limit", 500)
                .get("/api/v1/audit-events")
                .then()
                .statusCode(200)
                .extract()
                .path("findAll { it.action.startsWith('" + prefix + "') }");
    }

    /** Waits until the extension of the tests was told of an event about a resource. */
    private PlatformEvent told(String type, String id) {
        Instant end = Instant.now().plus(WAIT);
        while (Instant.now().isBefore(end)) {
            outside(() -> dispatcher.dispatch(Instant.now()));
            List<PlatformEvent> found = told.of(type, id);
            if (!found.isEmpty()) {
                return found.getFirst();
            }
            try {
                Thread.sleep(100);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(e);
            }
        }
        return fail("The extension was not told %s of %s within %s", type, id, WAIT);
    }

    private int purgeDue(Instant now) {
        return outside(() -> purges.purgeDue(now));
    }

    private static <T> T outside(Supplier<T> work) {
        return CompletableFuture.supplyAsync(work).join();
    }

    // --- A deleted resource appears in the trash of its owner and of the administrators -----------

    @Test
    void aDeletedResourceIsInTheTrashOfItsOwnerAndOfTheAdministratorsWithWhatItHolds() {
        List<String> moved = trash("folder", sub);

        assertThat(moved.getFirst()).isEqualTo("folder/" + sub);
        assertThat(moved).containsExactlyInAnyOrder("folder/" + sub, "file/" + doc, "note/" + memo);
        assertThat(inTrash("file", doc)).isTrue();
        assertThat(inTrash("folder", top)).isFalse();
        assertThat(in(ada).get(PROBE + "file")
                        .then()
                        .statusCode(200)
                        .extract()
                        .jsonPath()
                        .getList("", String.class))
                .containsExactly(doc);
        // Trashing it again changes nothing.
        assertThat(trash("folder", sub)).isEmpty();

        // The owner sees the folder, with what went with it counted.
        Map<String, Object> entry = entry(sub);
        assertThat(entry)
                .containsEntry("extension", EXTENSION)
                .containsEntry("extensionName", "Drive (test)")
                .containsEntry("type", "folder")
                .containsEntry("typeTitle", "Folder")
                .containsEntry("title", "Sub")
                .containsEntry("contents", 2);
        assertThat(entry.get("trashedByName").toString()).startsWith("Pat ");
        Instant trashedAt = Instant.parse((String) entry.get("trashedAt"));
        Instant purgeableFrom = Instant.parse((String) entry.get("purgeableFrom"));
        assertThat(Duration.between(trashedAt, purgeableFrom)).isEqualTo(Duration.ofDays(30));
        assertThat(list(in(ada)).getList("resourceId", String.class)).containsExactly(sub);

        // Another member sees nothing, and not the trash of the organization.
        assertThat(list(in(bea)).getList("")).isEmpty();
        in(bea).queryParam("scope", "organization").get(TRASH).then().statusCode(403);
        // An administrator sees it in the trash of the organization, not in their own.
        assertThat(list(in(cleo)).getList("")).isEmpty();
        assertThat(list(in(cleo).queryParam("scope", "organization")).getList("resourceId", String.class))
                .containsExactly(sub);
        assertThat(list(in(cleo).queryParam("scope", "organization")).getString("[0].ownerName"))
                .startsWith("Pat ");

        // Nothing new goes inside a resource of the trash.
        resource("note", unique("late"), "Late", "folder/" + sub).then().statusCode(400);

        PlatformEvent trashed = told(PlatformEvents.RESOURCE_TRASHED, doc);
        assertThat(trashed.text("type")).isEqualTo("file");
        assertThat(trashed.text("title")).isEqualTo("Doc");
        assertThat(Instant.parse(trashed.text("purgeableFrom"))).isEqualTo(purgeableFrom);
        assertThat(audit("resource.trashed"))
                .singleElement()
                .satisfies(event -> assertThat(event.get("subject")).isEqualTo(EXTENSION + "/folder/" + sub));
    }

    // --- Restoring it brings it back with its shares ----------------------------------------------

    @Test
    void restoringAResourceBringsItBackWithItsShares() {
        share("folder", sub, "edit");
        share("note", memo, "view");
        String token = in(ada).body(Map.of(
                        "level",
                        "view",
                        "expires",
                        Instant.now().plus(Duration.ofDays(1)).toString()))
                .post(SHARING + "folder/" + sub + "/links")
                .then()
                .statusCode(201)
                .extract()
                .path("token");
        assertThat(level("file", doc)).isEqualTo("edit");
        assertThat(open(token)).isEqualTo(200);

        trash("folder", sub);

        // While in the trash nobody holds a level on them, and the link answers not found.
        assertThat(level("file", doc)).isEmpty();
        assertThat(level("note", memo)).isEmpty();
        assertThat(level("folder", sub)).isEmpty();
        JsonPath allows = allows("file", doc, "view");
        assertThat(allows.getBoolean("java")).isFalse();
        assertThat(allows.getBoolean("sql")).isFalse();
        assertThat(open(token)).isEqualTo(404);
        // A resource that went with its folder comes back only with it.
        in(ada).post(PROBE + "file/" + doc + "/restore").then().statusCode(400);
        // Only its owner or an administrator restores it.
        String id = (String) entry(sub).get("id");
        in(bea).post(TRASH + "/" + id + "/restore").then().statusCode(404);

        in(ada).post(TRASH + "/" + id + "/restore").then().statusCode(200).body("restored", equalTo(3));

        assertThat(inTrash("folder", sub)).isFalse();
        assertThat(inTrash("file", doc)).isFalse();
        assertThat(list(in(ada)).getList("")).isEmpty();
        assertThat(level("file", doc)).isEqualTo("edit");
        assertThat(level("note", memo)).isEqualTo("view");
        assertThat(allows("file", doc, "edit").getBoolean("sql")).isTrue();
        assertThat(open(token)).isEqualTo(200);
        in(ada).get(SHARING + "note/" + memo + "/grants").then().statusCode(200).body("$", hasSize(1));
        assertThat(told(PlatformEvents.RESOURCE_RESTORED, memo).text("title")).isEqualTo("Memo");
        assertThat(audit("resource.restored")).hasSize(1);
    }

    @Test
    void anAdministratorRestoresAResourceOfAnyoneAndTheExtensionMayUndoADeletion() {
        trash("note", memo);
        String id = (String) entry(memo).get("id");

        in(cleo).post(TRASH + "/" + id + "/restore").then().statusCode(200).body("restored", equalTo(1));
        assertThat(inTrash("note", memo)).isFalse();

        // The extension undoes a deletion itself.
        trash("folder", sub);
        assertThat(in(ada).post(PROBE + "folder/" + sub + "/restore")
                        .then()
                        .statusCode(200)
                        .extract()
                        .jsonPath()
                        .getList("", String.class))
                .containsExactlyInAnyOrder("folder/" + sub, "file/" + doc, "note/" + memo);
        assertThat(in(ada).post(PROBE + "folder/" + sub + "/restore")
                        .then()
                        .statusCode(200)
                        .extract()
                        .jsonPath()
                        .getList(""))
                .isEmpty();
    }

    @Test
    void aResourceTrashedBeforeItsFolderStaysInTheTrashOnItsOwn() {
        trash("note", memo);
        trash("folder", sub);

        assertThat(entry(sub)).containsEntry("contents", 1);
        String memoId = (String) entry(memo).get("id");
        // Its folder is in the trash: restore that first.
        in(ada).post(TRASH + "/" + memoId + "/restore").then().statusCode(409);

        in(ada).post(TRASH + "/" + entry(sub).get("id") + "/restore")
                .then()
                .statusCode(200)
                .body("restored", equalTo(2));
        assertThat(inTrash("file", doc)).isFalse();
        assertThat(inTrash("note", memo)).isTrue();

        in(ada).post(TRASH + "/" + memoId + "/restore").then().statusCode(200);
        assertThat(inTrash("note", memo)).isFalse();
    }

    // --- Resources in the trash longer than the retention are deleted for good --------------------

    @Test
    void resourcesInTheTrashLongerThanTheRetentionAreDeletedForGood() {
        share("folder", sub, "view");
        trash("folder", sub);
        Instant purgeableFrom = Instant.parse((String) entry(sub).get("purgeableFrom"));

        purgeDue(Instant.now());
        purgeDue(purgeableFrom.minusSeconds(1));
        assertThat(inTrash("folder", sub)).isTrue();

        assertThat(purgeDue(purgeableFrom.plusSeconds(1))).isGreaterThanOrEqualTo(3);

        in(ada).get(RESOURCES + "folder/" + sub).then().statusCode(404);
        in(ada).get(RESOURCES + "file/" + doc).then().statusCode(404);
        in(ada).get(RESOURCES + "note/" + memo).then().statusCode(404);
        in(ada).get(RESOURCES + "folder/" + top).then().statusCode(200);
        assertThat(list(in(ada)).getList("")).isEmpty();
        assertThat(told(PlatformEvents.RESOURCE_PURGED, doc).text("type")).isEqualTo("file");
        assertThat(told(PlatformEvents.RESOURCE_PURGED, sub).text("title")).isEqualTo("Sub");
        assertThat(audit("resource.purged")).singleElement().satisfies(event -> {
            assertThat(event.get("channel")).isEqualTo("JOB");
            assertThat(event.get("subject")).isEqualTo(EXTENSION + "/folder/" + sub);
        });
    }

    @Test
    void theOwnerDeletesAResourceOfTheTrashForGood() {
        trash("note", memo);
        String id = (String) entry(memo).get("id");

        in(bea).delete(TRASH + "/" + id).then().statusCode(404);
        in(ada).delete(TRASH + "/" + id).then().statusCode(204);

        in(ada).get(RESOURCES + "note/" + memo).then().statusCode(404);
        in(ada).get(RESOURCES + "file/" + doc).then().statusCode(200);
        assertThat(told(PlatformEvents.RESOURCE_PURGED, memo).text("id")).isEqualTo(memo);
    }

    @Test
    void theRetentionIsADayAtLeastWhateverTheSettingOrTheCodeSays() throws SQLException {
        assertThat(KernelTrash.retention(null)).isEqualTo(Duration.ofDays(1));
        assertThat(KernelTrash.retention(Duration.ZERO)).isEqualTo(Duration.ofDays(1));
        assertThat(KernelTrash.retention(Duration.ofHours(-3))).isEqualTo(Duration.ofDays(1));
        assertThat(KernelTrash.retention(Duration.ofDays(90))).isEqualTo(Duration.ofDays(90));

        trash("note", memo);
        try (var connection = dataSource.getConnection();
                var owner = connection.createStatement();
                var statement = connection.prepareStatement(
                        "update mk_kernel.resource set purgeable_from = trashed_at where ref_id = ?")) {
            owner.execute("set role none");
            statement.setString(1, memo);
            assertThatThrownBy(statement::executeUpdate)
                    .isInstanceOf(SQLException.class)
                    .hasMessageContaining("resource_trash_ck");
        }
        assertThat(purgeDue(Instant.now().plus(Duration.ofHours(23)))).isGreaterThanOrEqualTo(0);
        assertThat(inTrash("note", memo)).isTrue();
    }

    @Test
    void removingATrashedFolderLeavesWhatWentWithItInTheTrashOnItsOwn() {
        trash("folder", sub);

        in(ada).delete(RESOURCES + "folder/" + sub).then().statusCode(204);

        assertThat(list(in(ada)).getList("resourceId", String.class)).containsExactlyInAnyOrder(doc, memo);
        String id = (String) entry(doc).get("id");
        in(ada).post(TRASH + "/" + id + "/restore").then().statusCode(200);
        assertThat(inTrash("file", doc)).isFalse();
        assertThat(inTrash("note", memo)).isTrue();
    }
}
