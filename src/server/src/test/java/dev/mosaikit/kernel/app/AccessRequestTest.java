// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Requests for access (MK-058), on the drive fixture of {@link InheritedLevelsTest}: ada owns the
 * folder {@code top} and the file {@code doc} inside it, bea is a member refused both, cleo an
 * administrator of the organization, dan a member who may not share them.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-058")
class AccessRequestTest {

    static final String EXTENSION = InheritedLevelsTest.EXTENSION;
    static final String PASSWORD = "Correct-Horse-9";
    static final String RESOURCES = "/api/v1/test/resources/" + EXTENSION + "/";
    static final String LEVELS = "/api/v1/test/sharing/" + EXTENSION + "/";
    static final String SHARING = "/api/v1/sharing/resources/" + EXTENSION + "/";
    static final String REQUESTS = "/api/v1/access-requests";

    private String acme;
    private String ada;
    private String bea;
    private String cleo;
    private String dan;
    private String top;
    private String doc;

    @BeforeEach
    void tree() {
        acme = unique("access");
        asAdmin()
                .body(Map.of("slug", acme, "name", acme, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        ada = register();
        bea = register();
        cleo = register();
        dan = register();
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", acme, cleo)
                .then()
                .statusCode(200);
        top = unique("top");
        doc = unique("doc");
        resource("folder", top, "Budget folder", null);
        resource("file", doc, "Budget 2027", "folder/" + top);
    }

    private String register() {
        String email = unique("access") + "@example.org";
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

    private void resource(String type, String id, String title, String parent) {
        Map<String, Object> body = new HashMap<>(Map.of("title", title, "link", "/app/drive/" + id));
        if (parent != null) {
            body.put("parent", EXTENSION + "/" + parent);
        }
        in(ada).body(body).put(RESOURCES + type + "/" + id).then().statusCode(200);
    }

    private Map<String, Object> ask(String person, String type, String id, String level, String message) {
        Map<String, Object> body = new HashMap<>(Map.of("extension", EXTENSION, "type", type, "id", id));
        if (level != null) {
            body.put("level", level);
        }
        body.put("message", message);
        return in(person)
                .body(body)
                .post(REQUESTS)
                .then()
                .statusCode(202)
                .extract()
                .jsonPath()
                .getMap("");
    }

    private List<Map<String, Object>> toDecide(String person) {
        return in(person)
                .get(REQUESTS)
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getList("");
    }

    private List<Map<String, Object>> notifications(String person) {
        return in(person)
                .get("/api/v1/notifications")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getList("notifications");
    }

    private List<Map<String, Object>> notificationsOf(String person, String kind) {
        return notifications(person).stream()
                .filter(found -> kind.equals(found.get("kind")))
                .toList();
    }

    private String level(String person, String type, String id) {
        return in(person)
                .get(LEVELS + type + "/" + id + "/level")
                .then()
                .statusCode(200)
                .extract()
                .path("level");
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

    // --- 1. A person refused access sends a request with a message from the page that refused them ---

    @Test
    void aPersonRefusedSendsARequestWithAMessageThatRevealsNothingOfTheResource() {
        // The page refuses bea: the sharing dialog does not even admit the file exists.
        in(bea).get(SHARING + "file/" + doc).then().statusCode(404);

        Map<String, Object> sent = ask(bea, "file", doc, "edit", "I review the budget this week.");

        assertThat(sent)
                .containsEntry("level", "edit")
                .containsEntry("message", "I review the budget this week.")
                .containsEntry("status", "pending")
                .containsKeys("id", "created")
                .doesNotContainKeys("title", "link", "owner");
        assertThat(sent.get("resource")).isEqualTo(Map.of("extension", EXTENSION, "type", "file", "id", doc));

        // A request for a resource that does not exist gets the same answer: nothing tells them apart.
        Map<String, Object> nowhere = ask(bea, "file", unique("nothing"), "edit", "I review the budget this week.");
        assertThat(nowhere.keySet()).isEqualTo(sent.keySet());
        assertThat(nowhere).containsEntry("status", "pending").containsEntry("level", "edit");

        // Without a level, the lowest of the type is asked; asking again replaces the message.
        assertThat(ask(bea, "folder", top, null, "")).containsEntry("level", "view");
        Map<String, Object> again = ask(bea, "file", doc, "edit", "Only the totals, please.");
        assertThat(again.get("id")).isEqualTo(sent.get("id"));
        List<Map<String, Object>> mine = in(bea).get(REQUESTS + "/mine")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getList("");
        assertThat(mine).hasSize(3);
        assertThat(mine)
                .anySatisfy(found -> assertThat(found)
                        .containsEntry("id", sent.get("id"))
                        .containsEntry("message", "Only the totals, please."));

        // Input is checked against the manifests only.
        in(bea).body(Map.of("extension", EXTENSION, "type", "file", "id", doc, "level", "own"))
                .post(REQUESTS)
                .then()
                .statusCode(400);
        in(bea).body(Map.of("extension", EXTENSION, "type", "spreadsheet", "id", doc))
                .post(REQUESTS)
                .then()
                .statusCode(400);
        in(bea).body(Map.of("extension", EXTENSION, "type", "file", "id", doc, "message", "x".repeat(1001)))
                .post(REQUESTS)
                .then()
                .statusCode(400);
        anonymous()
                .body(Map.of("extension", EXTENSION, "type", "file", "id", doc))
                .post(REQUESTS)
                .then()
                .statusCode(401);

        assertThat(audit("access.requested"))
                .anySatisfy(event -> assertThat(event.get("subject")).isEqualTo(EXTENSION + "/file/" + doc));
    }

    // --- 2. The owner or the administrator is notified and decides from one list -------------------

    @Test
    void theOwnerIsNotifiedAndTheOwnerOrAnAdministratorDecidesFromOneList() {
        ask(bea, "file", doc, "edit", "I review the budget this week.");
        ask(bea, "file", unique("nothing"), "view", "Anything?");

        List<Map<String, Object>> told = notificationsOf(ada, "access-request");
        assertThat(told).hasSize(1);
        assertThat(told.getFirst())
                .containsEntry("extensionId", "kernel")
                .containsEntry("link", "/access-requests")
                .containsEntry("body", "I review the budget this week.");
        assertThat(told.getFirst().get("title").toString())
                .startsWith("Pat ")
                .endsWith("asks for access to Budget 2027");

        // One list: the owner and the administrators see the request, with what they need to decide.
        List<Map<String, Object>> owners = toDecide(ada);
        assertThat(owners).hasSize(1);
        assertThat(owners.getFirst())
                .containsEntry("title", "Budget 2027")
                .containsEntry("link", "/app/drive/" + doc)
                .containsEntry("typeTitle", "File")
                .containsEntry("level", "edit")
                .containsEntry("requesterEmail", bea)
                .containsEntry("message", "I review the budget this week.");
        assertThat(toDecide(cleo))
                .extracting(found -> found.get("id"))
                .containsExactly(owners.getFirst().get("id"));
        // Who may not share the file sees nothing and decides nothing.
        assertThat(toDecide(dan)).isEmpty();
        assertThat(toDecide(bea)).isEmpty();
        String id = owners.getFirst().get("id").toString();
        in(dan).body(Map.of()).post(REQUESTS + "/" + id + "/approve").then().statusCode(404);
        in(bea).body(Map.of()).post(REQUESTS + "/" + id + "/approve").then().statusCode(404);

        // The administrator decides as the owner would.
        in(cleo).body(Map.of("reason", "Ask Ada."))
                .post(REQUESTS + "/" + id + "/reject")
                .then()
                .statusCode(200);
        assertThat(toDecide(ada)).isEmpty();
        in(ada).body(Map.of()).post(REQUESTS + "/" + id + "/approve").then().statusCode(404);
        assertThat(audit("access.request.rejected")).hasSize(1);
    }

    // --- 3. An approved request grants the access asked; the requester learns the outcome ---------

    @Test
    void anApprovedRequestGrantsTheLevelAskedAndTheRequesterIsNotified() {
        assertThat(level(bea, "file", doc)).isEmpty();
        ask(bea, "file", doc, "edit", "I review the budget this week.");
        String id = toDecide(ada).getFirst().get("id").toString();

        Map<String, Object> approved = in(ada).body(Map.of())
                .post(REQUESTS + "/" + id + "/approve")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getMap("");

        assertThat(approved).containsEntry("status", "approved").containsEntry("grantedLevel", "edit");
        assertThat(level(bea, "file", doc)).isEqualTo("edit");
        // Granted with the sharing model: a grant to bea that the sharing dialog lists, audited.
        List<Map<String, Object>> grants = in(ada).get(SHARING + "file/" + doc + "/grants")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getList("");
        assertThat(grants).anySatisfy(grant -> assertThat(grant).containsEntry("level", "edit"));
        assertThat(audit("sharing.granted")).isNotEmpty();
        assertThat(audit("access.request.approved")).hasSize(1);

        List<Map<String, Object>> outcome = notificationsOf(bea, "access-request-outcome");
        assertThat(outcome).hasSize(1);
        assertThat(outcome.getFirst())
                .containsEntry("title", "Your request for access to Budget 2027 was approved")
                .containsEntry("link", "/app/drive/" + doc);
        assertThat(toDecide(ada)).isEmpty();
    }

    @Test
    void theDeciderMayGrantAnotherLevelAndARequesterWhoHoldsItKeepsTheirs() {
        ask(bea, "folder", top, "manage", "");
        String id = toDecide(ada).getFirst().get("id").toString();
        in(ada).body(Map.of("level", "view"))
                .post(REQUESTS + "/" + id + "/approve")
                .then()
                .statusCode(200);
        assertThat(level(bea, "folder", top)).isEqualTo("view");
        // Inherited by the file inside it (MK-136).
        assertThat(level(bea, "file", doc)).isEqualTo("view");

        // Asking again for view on the file, already held: approving changes nothing.
        ask(bea, "file", doc, "view", "");
        String again = toDecide(ada).getFirst().get("id").toString();
        in(ada).body(Map.of()).post(REQUESTS + "/" + again + "/approve").then().statusCode(200);
        assertThat(level(bea, "file", doc)).isEqualTo("view");
        // A level the type does not have is refused.
        ask(bea, "file", doc, "edit", "");
        String third = toDecide(ada).getFirst().get("id").toString();
        in(ada).body(Map.of("level", "own"))
                .post(REQUESTS + "/" + third + "/approve")
                .then()
                .statusCode(400);
    }

    @Test
    void aRejectedRequestGrantsNothingAndItsNotificationDoesNotNameTheResource() {
        ask(bea, "file", doc, "edit", "I review the budget this week.");
        String id = toDecide(ada).getFirst().get("id").toString();

        in(ada).body(Map.of("reason", "Not before the board meets."))
                .post(REQUESTS + "/" + id + "/reject")
                .then()
                .statusCode(200);

        assertThat(level(bea, "file", doc)).isEmpty();
        List<Map<String, Object>> outcome = notificationsOf(bea, "access-request-outcome");
        assertThat(outcome).hasSize(1);
        assertThat(outcome.getFirst())
                .containsEntry("title", "Your request for access was declined")
                .containsEntry("link", null);
        assertThat(outcome.getFirst().get("body").toString())
                .contains("I review the budget this week.")
                .contains("Not before the board meets.")
                .doesNotContain("Budget 2027");
        List<Map<String, Object>> mine = in(bea).get(REQUESTS + "/mine")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getList("");
        assertThat(mine.getFirst())
                .containsEntry("status", "rejected")
                .containsEntry("reason", "Not before the board meets.");
    }

    @Test
    void theRequesterWithdrawsAPendingRequest() {
        String id = ask(bea, "file", doc, "view", "").get("id").toString();
        in(dan).delete(REQUESTS + "/" + id).then().statusCode(404);
        in(bea).delete(REQUESTS + "/" + id).then().statusCode(204);
        assertThat(toDecide(ada)).isEmpty();
        in(bea).delete(REQUESTS + "/" + id).then().statusCode(404);
    }
}
