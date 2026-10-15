// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.api.resource.ResourceRef;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Offboarding a member with the transfer of their resources (MK-071). Ada owns a folder and a file
 * in the drive extension of {@link InheritedLevelsTest} and a note of the extension of
 * {@link ResourceRegistryTest}, and shares the file with dan; bea takes them over, cleo administers
 * the organization. The drive follows the transfer through {@link OwnershipRecorder}.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-071")
class OffboardingTest {

    static final String DRIVE = InheritedLevelsTest.EXTENSION;
    static final String NOTES = "dev.mosaikit.test.resources";
    static final String PASSWORD = "Correct-Horse-9";
    static final String MEMBERS = "/api/v1/organizations/{slug}/members/{email}";

    @Inject
    OwnershipRecorder recorder;

    private String acme;
    private UUID acmeId;
    private String ada;
    private String bea;
    private String cleo;
    private String dan;
    private UUID beaId;
    private String folder;
    private String file;
    private String note;

    @BeforeEach
    void organization() {
        acme = unique("offboard");
        asAdmin()
                .body(Map.of("slug", acme, "name", acme, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        acmeId = UUID.fromString(
                asAdmin().get("/api/v1/organizations/{slug}", acme).path("id"));
        ada = register();
        bea = register();
        cleo = register();
        dan = register();
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put(MEMBERS, acme, cleo)
                .then()
                .statusCode(200);
        beaId = UUID.fromString(in(bea).get("/api/v1/accounts/me").path("id"));
        String danId = in(dan).get("/api/v1/accounts/me").path("id");
        folder = unique("folder");
        file = unique("file");
        note = unique("note");
        register(DRIVE, "folder", folder, "Plans", null);
        register(DRIVE, "file", file, "Budget", DRIVE + "/folder/" + folder);
        register(NOTES, "note", note, "Minutes", null);
        in(ada).body(Map.of("subject", Map.of("kind", "person", "id", danId), "level", "view"))
                .put("/api/v1/sharing/resources/" + DRIVE + "/file/" + file + "/grants")
                .then()
                .statusCode(200);
    }

    @AfterEach
    void accept() {
        recorder.refuseTo(null);
    }

    private String register() {
        String email = unique("offboard") + "@example.org";
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

    private void register(String extension, String type, String id, String title, String parent) {
        Map<String, Object> body = new HashMap<>(Map.of("title", title, "link", "/app/x/" + id));
        if (parent != null) {
            body.put("parent", parent);
        }
        in(ada).body(body)
                .put("/api/v1/test/resources/" + extension + "/" + type + "/" + id)
                .then()
                .statusCode(200);
    }

    private List<Map<String, Object>> owned(String person) {
        return in(cleo).get(MEMBERS + "/resources", acme, person)
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getList("");
    }

    private String level(String person, String type, String id) {
        return in(person)
                .get("/api/v1/test/sharing/" + DRIVE + "/" + type + "/" + id + "/level")
                .then()
                .statusCode(200)
                .extract()
                .path("level");
    }

    private boolean member(String person) {
        return asAdmin()
                .get("/api/v1/organizations/{slug}/members", acme)
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getList("username", String.class)
                .contains(person);
    }

    // --- 1. Removing a member first shows the resources they own, per extension -------------------

    @Test
    void theResourcesOfAMemberAreShownPerExtensionBeforeTheRemoval() {
        List<Map<String, Object>> owned = owned(ada);

        assertThat(owned).extracting(group -> group.get("extension")).containsExactly(DRIVE, NOTES);
        assertThat(owned.getFirst()).containsEntry("extensionName", "Drive (test)");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> drive =
                (List<Map<String, Object>>) owned.getFirst().get("resources");
        assertThat(drive).extracting(resource -> resource.get("title")).containsExactlyInAnyOrder("Plans", "Budget");
        assertThat(drive)
                .anySatisfy(resource -> assertThat(resource)
                        .containsEntry("type", "file")
                        .containsEntry("typeTitle", "File")
                        .containsEntry("id", file)
                        .containsEntry("trashed", false));
        assertThat(owned(bea)).isEmpty();

        // The administrators of the organization and of the platform see them; the members do not.
        asAdmin().get(MEMBERS + "/resources", acme, ada).then().statusCode(200);
        in(bea).get(MEMBERS + "/resources", acme, ada).then().statusCode(403);
        in(cleo).get(MEMBERS + "/resources", acme, "nobody@example.org").then().statusCode(404);

        // A member who owns something is not removed without someone to take it over.
        in(cleo).delete(MEMBERS, acme, ada).then().statusCode(409);
        assertThat(member(ada)).isTrue();
    }

    // --- 2. The administrator chooses a new owner; the resources keep their shares ----------------

    @Test
    void afterTheRemovalTheResourcesBelongToTheNewOwnerWithTheirSharesIntact() {
        in(cleo).queryParam("transferTo", bea).delete(MEMBERS, acme, ada).then().statusCode(204);

        assertThat(member(ada)).isFalse();
        assertThat(owned(bea)).extracting(group -> group.get("extension")).containsExactly(DRIVE, NOTES);
        assertThat(level(bea, "file", file)).isEqualTo("manage");
        assertThat(level(bea, "folder", folder)).isEqualTo("manage");
        // The shares are as they were.
        assertThat(level(dan, "file", file)).isEqualTo("view");
        List<Map<String, Object>> grants = in(bea).get(
                        "/api/v1/sharing/resources/" + DRIVE + "/file/" + file + "/grants")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getList("");
        assertThat(grants).hasSize(1);
        assertThat(grants.getFirst()).containsEntry("level", "view");

        String organizationId = acmeId.toString();
        List<Map<String, Object>> audited = asAdmin()
                .queryParam("organization", organizationId)
                .queryParam("limit", 500)
                .get("/api/v1/audit-events")
                .then()
                .statusCode(200)
                .extract()
                .path("findAll { it.action == 'organization.member.resources.transferred' }");
        assertThat(audited).hasSize(1);
        assertThat(audited.getFirst().get("detail").toString()).contains(bea).contains(DRIVE);
    }

    @Test
    void theNewOwnerIsAnotherMemberAndAdministratorsDoNotRemoveThemselves() {
        in(cleo).queryParam("transferTo", ada).delete(MEMBERS, acme, ada).then().statusCode(400);
        in(cleo).queryParam("transferTo", "nobody@example.org")
                .delete(MEMBERS, acme, ada)
                .then()
                .statusCode(400);
        in(bea).queryParam("transferTo", bea).delete(MEMBERS, acme, ada).then().statusCode(403);
        in(cleo).delete(MEMBERS, acme, cleo).then().statusCode(403);
        assertThat(member(ada)).isTrue();
        assertThat(owned(ada)).hasSize(2);

        // A member who owns nothing is removed as before.
        in(cleo).delete(MEMBERS, acme, dan).then().statusCode(204);
    }

    // --- 3. Extensions receive the transfer through an extension point --------------------------

    @Test
    void theExtensionReceivesTheTransferOfItsResources() {
        in(cleo).queryParam("transferTo", bea).delete(MEMBERS, acme, ada).then().statusCode(204);

        List<OwnershipRecorder.Transfer> received = recorder.in(acmeId);
        assertThat(received).hasSize(1);
        OwnershipRecorder.Transfer transfer = received.getFirst();
        assertThat(transfer.to()).isEqualTo(beaId);
        assertThat(transfer.resources())
                .containsExactlyInAnyOrder(
                        new ResourceRef(DRIVE, "folder", folder), new ResourceRef(DRIVE, "file", file));
        assertThat(transfer.ids("file")).containsExactly(file);
    }

    @Test
    void anExtensionThatRefusesTheTransferKeepsTheMemberAndTheirResources() {
        recorder.refuseTo(beaId);

        int status = in(cleo).queryParam("transferTo", bea)
                .delete(MEMBERS, acme, ada)
                .statusCode();

        assertThat(status).isGreaterThanOrEqualTo(400);
        assertThat(member(ada)).isTrue();
        assertThat(owned(ada)).hasSize(2);
        assertThat(owned(bea)).isEmpty();
        assertThat(recorder.in(acmeId)).isEmpty();
    }
}
