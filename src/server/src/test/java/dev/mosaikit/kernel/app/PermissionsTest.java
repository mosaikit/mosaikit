// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasItems;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.hamcrest.Matchers.startsWith;

import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.permissions.PermissionAdministration;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Permissions declared by extensions, granted through profiles, teams and personal exceptions
 * (MK-056, ADR-0038): the rules of the {@code Permissions} bean, as an extension sees them through
 * {@link PermissionsProbe}, and the API with which the administrators of an organization manage them.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-056")
class PermissionsTest {

    static final String EXTENSION = "dev.mosaikit.test.permissions";
    static final String PERMISSIONS = """
            permissions:
              - name: create-dashboard
                title: Create dashboards
                description: Create new dashboards of the organization.
              - { name: view-dashboard, title: View dashboards }
            """;
    static final String CREATE = EXTENSION + ":create-dashboard";
    static final String VIEW = EXTENSION + ":view-dashboard";
    static final String TODO = "dev.mosaikit.test.todo";
    static final String ADD_ITEM = TODO + ":add-item";
    static final String PASSWORD = "a long enough password";

    @Inject
    ExtensionRegistry extensions;

    @Inject
    PermissionAdministration administration;

    private String acme;
    private String globex;
    private String boss;
    private String ada;
    private String bea;
    private String cleo;
    private String globexBoss;

    @BeforeEach
    void people() {
        acme = organization();
        globex = organization();
        boss = register(acme);
        ada = register(acme);
        bea = register(acme);
        cleo = register(globex);
        globexBoss = register(globex);
        administrator(boss, acme);
        administrator(globexBoss, globex);
    }

    // Helpers.

    private static String organization() {
        String slug = unique("permissions");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("permissions") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static void administrator(String email, String organization) {
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", organization, email)
                .then()
                .statusCode(200);
    }

    private static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    /** The answer of an endpoint of the extension that requires the permission. */
    private static int require(String person, String organization, String qualified) {
        String[] parts = qualified.split(":");
        return in(person, organization)
                .get("/api/v1/test/permissions/require/{extension}/{permission}", parts[0], parts[1])
                .statusCode();
    }

    private String admin(String organization) {
        return "/api/v1/organizations/" + organization + "/permissions";
    }

    private String profile(String name, String defaultForRole, String... permissions) {
        Map<String, Object> body = new HashMap<>(Map.of("name", name, "permissions", List.of(permissions)));
        if (defaultForRole != null) {
            body.put("defaultForRole", defaultForRole);
        }
        return in(boss, acme)
                .body(body)
                .post(admin(acme) + "/profiles")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
    }

    private void assign(String person, String profile) {
        Map<String, Object> body = new HashMap<>();
        body.put("profile", profile);
        in(boss, acme)
                .body(body)
                .put(admin(acme) + "/members/{email}/profile", person)
                .then()
                .statusCode(200);
    }

    private String team(String name, String... people) {
        String id = in(boss, acme)
                .body(Map.of("name", name, "description", "The people of " + name, "visibility", "private"))
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
        for (String person : people) {
            String role = person.equals(cleo) ? "guest" : "member";
            in(boss, acme)
                    .body(Map.of("role", role))
                    .put("/api/v1/teams/" + id + "/members/" + person)
                    .then()
                    .statusCode(200);
        }
        return id;
    }

    // Acceptance.

    @Test
    void aDeclaredPermissionIsOffUntilAProfileGrantsIt() {
        in(boss, acme)
                .get(admin(acme))
                .then()
                .statusCode(200)
                .body("find { it.id == '" + CREATE + "' }.extension", equalTo(EXTENSION))
                .body("find { it.id == '" + CREATE + "' }.name", equalTo("create-dashboard"))
                .body("find { it.id == '" + CREATE + "' }.title", equalTo("Create dashboards"))
                .body("find { it.id == '" + CREATE + "' }.description", startsWith("Create new dashboards"))
                .body("find { it.id == '" + CREATE + "' }.off", equalTo(false))
                .body("id", hasItems(CREATE, VIEW, ADD_ITEM));
        in(boss, acme).get(admin(acme) + "/profiles").then().statusCode(200).body("$", empty());

        // Deny by default: a member without a grant gets 403 from the extension, even around the UI.
        assertThat(require(ada, acme, CREATE)).isEqualTo(403);
        in(ada, acme)
                .get("/api/v1/test/permissions/require/{extension}/{permission}", EXTENSION, "create-dashboard")
                .then()
                .body("status", equalTo(403))
                .body("detail", equalTo("You do not have the permission " + CREATE));
        in(ada, acme).get("/api/v1/shell/permissions").then().statusCode(200).body("$", empty());

        // A profile assigned to the member grants it; the others still lack it.
        String builders = profile("Builders", null, CREATE);
        assign(ada, builders);
        assertThat(require(ada, acme, CREATE)).isEqualTo(204);
        assertThat(require(ada, acme, VIEW)).isEqualTo(403);
        assertThat(require(bea, acme, CREATE)).isEqualTo(403);
        in(ada, acme).get("/api/v1/shell/permissions").then().body("$", contains(CREATE));
        in(ada, acme)
                .get("/api/v1/test/permissions/granted/{extension}", EXTENSION)
                .then()
                .body("$", contains("create-dashboard"));

        // The default profile of the role is for the members without a profile of their own: one
        // profile per member, so Ada does not get it.
        String viewers = profile("Viewers", "organization-user", VIEW);
        assertThat(require(bea, acme, VIEW)).isEqualTo(204);
        assertThat(require(ada, acme, VIEW)).isEqualTo(403);
        in(boss, acme)
                .get(admin(acme) + "/members/{email}", bea)
                .then()
                .body("standing", equalTo("member"))
                .body("profile.id", equalTo(viewers))
                .body("profileAssigned", equalTo(false));

        // Back to the default.
        assign(ada, null);
        assertThat(require(ada, acme, VIEW)).isEqualTo(204);
        assertThat(require(ada, acme, CREATE)).isEqualTo(403);

        // A new default replaces the previous one.
        String readers = profile("Readers", "organization-user");
        in(boss, acme).get(admin(acme) + "/profiles/" + viewers).then().body("defaultForRole", nullValue());
        in(boss, acme)
                .get(admin(acme) + "/profiles/" + readers)
                .then()
                .body("defaultForRole", equalTo("organization-user"));
        assertThat(require(ada, acme, VIEW)).isEqualTo(403);
    }

    @Test
    void teamsAndPersonalExceptionsOnlyAdd() {
        String builders = profile("Builders", null, VIEW);
        assign(ada, builders);
        String roads = team("Roads", ada);
        assertThat(require(ada, acme, CREATE)).isEqualTo(403);

        // Granted to a team of the member: the same request succeeds.
        in(boss, acme)
                .put(admin(acme) + "/teams/{id}/{permission}", roads, CREATE)
                .then()
                .statusCode(200)
                .body("permissions", contains(CREATE));
        assertThat(require(ada, acme, CREATE)).isEqualTo(204);
        assertThat(require(bea, acme, CREATE)).isEqualTo(403);
        in(boss, acme)
                .delete(admin(acme) + "/teams/{id}/{permission}", roads, CREATE)
                .then()
                .statusCode(200);
        assertThat(require(ada, acme, CREATE)).isEqualTo(403);

        // As a personal exception.
        in(boss, acme)
                .put(admin(acme) + "/members/{email}/exceptions/{permission}", ada, CREATE)
                .then()
                .statusCode(200)
                .body("exceptions", contains(CREATE));
        assertThat(require(ada, acme, CREATE)).isEqualTo(204);

        // Where each permission comes from.
        in(boss, acme)
                .put(admin(acme) + "/teams/{id}/{permission}", roads, CREATE)
                .then()
                .statusCode(200);
        in(boss, acme)
                .get(admin(acme) + "/members/{email}", ada)
                .then()
                .statusCode(200)
                .body("profile.name", equalTo("Builders"))
                .body("profileAssigned", equalTo(true))
                .body("permissions.id", contains(CREATE, VIEW))
                .body(
                        "permissions.find { it.id == '" + CREATE + "' }.sources.kind",
                        containsInAnyOrder("team", "exception"))
                .body(
                        "permissions.find { it.id == '" + CREATE + "' }.sources.find { it.kind == 'team' }.name",
                        equalTo("Roads"))
                .body("permissions.find { it.id == '" + VIEW + "' }.sources.kind", contains("profile"))
                .body("permissions.find { it.id == '" + VIEW + "' }.sources[0].name", equalTo("Builders"))
                .body("permissions.granted", everyItem(equalTo(true)));

        // Revoking one source leaves the other.
        in(boss, acme)
                .delete(admin(acme) + "/members/{email}/exceptions/{permission}", ada, CREATE)
                .then()
                .statusCode(200)
                .body("exceptions", empty());
        assertThat(require(ada, acme, CREATE)).isEqualTo(204);
    }

    @Test
    void administratorsHoldEverythingAndGuestsNothingUnlessGrantedExplicitly() {
        profile("Everyone", "organization-user", CREATE, VIEW);

        // The administrators of the organization, without any grant.
        assertThat(require(boss, acme, CREATE)).isEqualTo(204);
        assertThat(require(boss, acme, ADD_ITEM)).isEqualTo(204);
        in(boss, acme).get("/api/v1/shell/permissions").then().body("$", hasItems(CREATE, VIEW, ADD_ITEM));
        in(boss, acme)
                .get(admin(acme) + "/members/{email}", boss)
                .then()
                .body("standing", equalTo("administrator"))
                .body("permissions.find { it.id == '" + CREATE + "' }.sources.kind", hasItem("administrator"));
        // Each organization has its administrators; platform administrators hold nothing for being so.
        in(globexBoss, globex).get("/api/v1/shell/permissions").then().body("$", hasItem(CREATE));
        asAdmin().get("/api/v1/shell/permissions").then().statusCode(200).body("$", empty());

        // A guest: the profiles of the members do not reach them.
        String roads = team("Roads", cleo);
        RequestSpecification guest = in(cleo, acme);
        guest.get("/api/v1/shell/permissions").then().statusCode(200).body("$", empty());
        in(boss, acme)
                .get(admin(acme) + "/members/{email}", cleo)
                .then()
                .body("standing", equalTo("guest"))
                .body("profile", nullValue())
                .body("permissions", empty());
        in(boss, acme)
                .body(Map.of("profile", profile("Guests", null, VIEW)))
                .put(admin(acme) + "/members/{email}/profile", cleo)
                .then()
                .statusCode(400);

        // A team of theirs, or an exception, grants explicitly.
        in(boss, acme)
                .put(admin(acme) + "/teams/{id}/{permission}", roads, VIEW)
                .then()
                .statusCode(200);
        in(cleo, acme).get("/api/v1/shell/permissions").then().body("$", contains(VIEW));
        in(boss, acme)
                .put(admin(acme) + "/members/{email}/exceptions/{permission}", cleo, CREATE)
                .then()
                .statusCode(200);
        in(cleo, acme).get("/api/v1/shell/permissions").then().body("$", contains(CREATE, VIEW));
        // In their own organization the guest has only what it grants them.
        in(cleo, globex).get("/api/v1/shell/permissions").then().body("$", empty());
    }

    @Test
    void aPermissionThatTheExtensionDoesNotDeclareIsNeverGranted() {
        // Not even to an administrator.
        assertThat(require(boss, acme, EXTENSION + ":delete-everything")).isEqualTo(403);
        // An installed extension that declares no permissions.
        assertThat(require(boss, acme, "dev.mosaikit.test.notify:anything")).isEqualTo(403);
        // An extension that is not installed is refused, as for the registry of resources.
        in(boss, acme)
                .get("/api/v1/test/permissions/require/{extension}/{permission}", "dev.example.absent", "x")
                .then()
                .statusCode(400)
                .body("[0]", equalTo("dev.example.absent is not an active extension."));
        in(boss, acme)
                .get("/api/v1/test/permissions/granted/{extension}", "dev.example.absent")
                .then()
                .statusCode(400);

        // Nobody can grant one either.
        in(boss, acme)
                .body(Map.of("name", "Wrong", "permissions", List.of(EXTENSION + ":delete-everything")))
                .post(admin(acme) + "/profiles")
                .then()
                .statusCode(400);
        in(boss, acme)
                .body(Map.of("name", "Wrong", "permissions", List.of("not a permission")))
                .post(admin(acme) + "/profiles")
                .then()
                .statusCode(400);
        in(boss, acme)
                .put(admin(acme) + "/members/{email}/exceptions/{permission}", ada, "dev.example.absent:x")
                .then()
                .statusCode(400);
        String roads = team("Roads", ada);
        in(boss, acme)
                .put(admin(acme) + "/teams/{id}/{permission}", roads, EXTENSION + ":delete-everything")
                .then()
                .statusCode(400);
    }

    @Test
    void whenAllTheAppsOfAnExtensionAreOffNobodyHasItsPermissions() {
        in(boss, acme)
                .put(admin(acme) + "/members/{email}/exceptions/{permission}", ada, ADD_ITEM)
                .then()
                .statusCode(200);
        assertThat(require(ada, acme, ADD_ITEM)).isEqualTo(204);

        in(boss, acme)
                .body(List.of(
                        Map.of(
                                "extensionId",
                                TODO,
                                "appId",
                                "todo",
                                "enabled",
                                false,
                                "pinned",
                                false,
                                "roles",
                                List.of()),
                        Map.of(
                                "extensionId",
                                "dev.mosaikit.test.board",
                                "appId",
                                "board",
                                "enabled",
                                true,
                                "pinned",
                                false,
                                "roles",
                                List.of())))
                .put("/api/v1/organizations/{slug}/apps", acme)
                .then()
                .statusCode(200);

        assertThat(require(ada, acme, ADD_ITEM)).isEqualTo(403);
        assertThat(require(boss, acme, ADD_ITEM)).isEqualTo(403);
        in(boss, acme).get("/api/v1/shell/permissions").then().body("$", not(hasItem(ADD_ITEM)));
        in(boss, acme).get(admin(acme)).then().body("find { it.id == '" + ADD_ITEM + "' }.off", equalTo(true));
        in(boss, acme)
                .get(admin(acme) + "/members/{email}", ada)
                .then()
                .body("permissions.find { it.id == '" + ADD_ITEM + "' }.granted", equalTo(false))
                .body("permissions.find { it.id == '" + ADD_ITEM + "' }.withheld", equalTo("apps-off"));
        // Another organization keeps the app.
        assertThat(require(globexBoss, globex, ADD_ITEM)).isEqualTo(204);

        in(boss, acme)
                .body(List.of())
                .put("/api/v1/organizations/{slug}/apps", acme)
                .then()
                .statusCode(200);
        assertThat(require(ada, acme, ADD_ITEM)).isEqualTo(204);
    }

    @Test
    void newPermissionsArriveSwitchedOff() throws Exception {
        String publish = EXTENSION + ":publish";
        String all = profile("All", "organization-user", CREATE, VIEW);
        try {
            update(PERMISSIONS + "  - { name: publish, title: Publish dashboards }\n");

            in(boss, acme).get(admin(acme)).then().body("id", hasItem(publish));
            in(boss, acme).get(admin(acme) + "/profiles/" + all).then().body("permissions", contains(CREATE, VIEW));
            assertThat(require(ada, acme, publish)).isEqualTo(403);
            assertThat(require(boss, acme, publish)).isEqualTo(204);

            // Granted, then removed by an update: the grant goes, so the permission that a later
            // update brings back arrives switched off again.
            in(boss, acme)
                    .body(Map.of(
                            "name",
                            "All",
                            "defaultForRole",
                            "organization-user",
                            "permissions",
                            List.of(CREATE, VIEW, publish)))
                    .put(admin(acme) + "/profiles/" + all)
                    .then()
                    .statusCode(200);
            assertThat(require(ada, acme, publish)).isEqualTo(204);
            update(PERMISSIONS);
            assertThat(require(ada, acme, publish)).isEqualTo(403);
            int removed = CompletableFuture.supplyAsync(() -> administration.forgetUndeclared(extensions.all()))
                    .get();
            assertThat(removed).isGreaterThanOrEqualTo(1);
            update(PERMISSIONS + "  - { name: publish, title: Publish dashboards }\n");
            assertThat(require(ada, acme, publish)).isEqualTo(403);
            in(boss, acme).get(admin(acme) + "/profiles/" + all).then().body("permissions", contains(CREATE, VIEW));
        } finally {
            update(PERMISSIONS);
        }
    }

    @Test
    void noExtensionFoundKeepsTheGrants() throws Exception {
        profile("Kept", "organization-user", CREATE);
        int removed = CompletableFuture.supplyAsync(() -> administration.forgetUndeclared(List.of()))
                .get();
        assertThat(removed).isZero();
        assertThat(require(ada, acme, CREATE)).isEqualTo(204);
    }

    private void update(String permissions) throws Exception {
        TestExtensions.extension("permissions", EXTENSION, "Permissions", permissions);
        extensions.reload();
    }

    // The API of the administrators.

    @Test
    void onlyTheAdministratorsOfTheOrganizationManageItsPermissions() {
        String builders = profile("Builders", null, CREATE);
        // A member, the administrator of another organization, a platform administrator.
        in(ada, acme).get(admin(acme)).then().statusCode(403);
        in(ada, acme).get(admin(acme) + "/profiles").then().statusCode(403);
        in(ada, acme)
                .body(Map.of("name", "Mine", "permissions", List.of(CREATE)))
                .post(admin(acme) + "/profiles")
                .then()
                .statusCode(403);
        in(ada, acme)
                .put(admin(acme) + "/members/{email}/exceptions/{permission}", ada, CREATE)
                .then()
                .statusCode(403);
        in(ada, acme)
                .body(Map.of("role", "organization-user"))
                .post(admin(acme) + "/preview")
                .then()
                .statusCode(403);
        in(globexBoss, globex).get(admin(acme) + "/profiles").then().statusCode(403);
        asAdmin().get(admin(acme) + "/profiles").then().statusCode(403);
        anonymous().get(admin(acme)).then().statusCode(401);
        anonymous().get("/api/v1/shell/permissions").then().statusCode(401);

        // Another organization does not see the profiles, nor the people, nor the teams of this one.
        in(globexBoss, globex)
                .get(admin(globex) + "/profiles")
                .then()
                .statusCode(200)
                .body("$", empty());
        in(globexBoss, globex)
                .get(admin(globex) + "/profiles/" + builders)
                .then()
                .statusCode(404);
        in(globexBoss, globex)
                .body(Map.of("profile", builders))
                .put(admin(globex) + "/members/{email}/profile", cleo)
                .then()
                .statusCode(404);
        in(globexBoss, globex)
                .get(admin(globex) + "/members/{email}", ada)
                .then()
                .statusCode(404);
        String roads = team("Roads", ada);
        in(globexBoss, globex)
                .put(admin(globex) + "/teams/{id}/{permission}", roads, CREATE)
                .then()
                .statusCode(404);

        // Row-level security: plain SQL without a filter sees only the rows of the organization.
        in(globexBoss, globex)
                .get("/api/v1/test/permissions/visible")
                .then()
                .statusCode(200)
                .body("$", empty());
        in(boss, acme)
                .get("/api/v1/test/permissions/visible")
                .then()
                .body("$", contains("profile:Builders", "grant:" + CREATE));
    }

    @Test
    void profilesAreValidatedAndDeletingProfilesTeamsAndMembersCleansUp() {
        String builders = profile("Builders", null, CREATE);
        in(boss, acme)
                .body(Map.of("name", "builders"))
                .post(admin(acme) + "/profiles")
                .then()
                .statusCode(409);
        in(boss, acme)
                .body(Map.of("name", " "))
                .post(admin(acme) + "/profiles")
                .then()
                .statusCode(400);
        in(boss, acme)
                .body(Map.of("name", "Admins", "defaultForRole", "organization-admin"))
                .post(admin(acme) + "/profiles")
                .then()
                .statusCode(400);
        in(boss, acme)
                .body(Map.of("name", "Builders", "description", "Who builds", "permissions", List.of(CREATE, VIEW)))
                .put(admin(acme) + "/profiles/" + builders)
                .then()
                .statusCode(200)
                .body("description", equalTo("Who builds"))
                .body("permissions", contains(CREATE, VIEW));

        // Deleting the profile: its member goes back to the default.
        assign(ada, builders);
        assertThat(require(ada, acme, CREATE)).isEqualTo(204);
        in(boss, acme).delete(admin(acme) + "/profiles/" + builders).then().statusCode(204);
        assertThat(require(ada, acme, CREATE)).isEqualTo(403);
        in(boss, acme).get(admin(acme) + "/members/{email}", ada).then().body("profile", nullValue());
        in(boss, acme).get(admin(acme) + "/profiles/" + builders).then().statusCode(404);

        // Deleting the team takes its grants.
        String roads = team("Roads", ada);
        in(boss, acme)
                .put(admin(acme) + "/teams/{id}/{permission}", roads, CREATE)
                .then()
                .statusCode(200);
        assertThat(require(ada, acme, CREATE)).isEqualTo(204);
        in(boss, acme).delete("/api/v1/teams/" + roads).then().statusCode(204);
        assertThat(require(ada, acme, CREATE)).isEqualTo(403);

        // Removing the member takes their exceptions and their profile.
        String keepers = profile("Keepers", null, VIEW);
        assign(bea, keepers);
        in(boss, acme)
                .put(admin(acme) + "/members/{email}/exceptions/{permission}", bea, CREATE)
                .then()
                .statusCode(200);
        asAdmin()
                .delete("/api/v1/organizations/{slug}/members/{email}", acme, bea)
                .then()
                .statusCode(204);
        asAdmin()
                .body(Map.of("roles", List.of("organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", acme, bea)
                .then()
                .statusCode(200);
        in(boss, acme)
                .get(admin(acme) + "/members/{email}", bea)
                .then()
                .body("exceptions", empty())
                .body("profile", nullValue())
                .body("permissions", empty());
    }

    @Test
    void thePreviewOfAnInvitationShowsThePermissionsAndChangesNothing() {
        String builders = profile("Builders", null, CREATE);
        profile("Viewers", "organization-user", VIEW);
        String roads = team("Roads", ada);
        in(boss, acme)
                .put(admin(acme) + "/teams/{id}/{permission}", roads, ADD_ITEM)
                .then()
                .statusCode(200);
        String organizationId =
                asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");
        int before = permissionEvents(organizationId);
        String profilesBefore = in(boss, acme).get(admin(acme) + "/profiles").asString();

        in(boss, acme)
                .body(Map.of("role", "organization-user", "profile", builders, "teams", List.of(roads)))
                .post(admin(acme) + "/preview")
                .then()
                .statusCode(200)
                .body("standing", equalTo("member"))
                .body("profile.name", equalTo("Builders"))
                .body("permissions.id", contains(CREATE, ADD_ITEM))
                .body("permissions.find { it.id == '" + ADD_ITEM + "' }.sources[0].name", equalTo("Roads"));
        // Without a profile, the default of the role.
        in(boss, acme)
                .body(Map.of("role", "organization-user"))
                .post(admin(acme) + "/preview")
                .then()
                .body("profile.name", equalTo("Viewers"))
                .body("permissions.id", contains(VIEW));
        // A guest gets only the teams.
        in(boss, acme)
                .body(Map.of("role", "organization-guest", "teams", List.of(roads)))
                .post(admin(acme) + "/preview")
                .then()
                .body("standing", equalTo("guest"))
                .body("profile", nullValue())
                .body("permissions.id", contains(ADD_ITEM));
        // An administrator, everything.
        in(boss, acme)
                .body(Map.of("role", "organization-admin"))
                .post(admin(acme) + "/preview")
                .then()
                .body("permissions.id", hasItems(CREATE, VIEW, ADD_ITEM));
        // Invalid proposals.
        in(boss, acme)
                .body(Map.of("role", "platform-admin"))
                .post(admin(acme) + "/preview")
                .then()
                .statusCode(400);
        in(boss, acme)
                .body(Map.of("role", "organization-user", "teams", List.of("00000000-0000-0000-0000-000000000001")))
                .post(admin(acme) + "/preview")
                .then()
                .statusCode(404);

        assertThat(permissionEvents(organizationId)).isEqualTo(before);
        assertThat(in(boss, acme).get(admin(acme) + "/profiles").asString()).isEqualTo(profilesBefore);
    }

    @Test
    void everyChangeIsInTheAuditLog() {
        String builders = profile("Builders", null, CREATE);
        in(boss, acme)
                .body(Map.of("name", "Builders", "permissions", List.of(VIEW)))
                .put(admin(acme) + "/profiles/" + builders)
                .then()
                .statusCode(200);
        assign(ada, builders);
        String roads = team("Roads", ada);
        in(boss, acme)
                .put(admin(acme) + "/teams/{id}/{permission}", roads, CREATE)
                .then()
                .statusCode(200);
        in(boss, acme)
                .delete(admin(acme) + "/teams/{id}/{permission}", roads, CREATE)
                .then()
                .statusCode(200);
        in(boss, acme)
                .put(admin(acme) + "/members/{email}/exceptions/{permission}", ada, CREATE)
                .then()
                .statusCode(200);
        in(boss, acme)
                .delete(admin(acme) + "/members/{email}/exceptions/{permission}", ada, CREATE)
                .then()
                .statusCode(200);
        in(boss, acme).delete(admin(acme) + "/profiles/" + builders).then().statusCode(204);

        String organizationId =
                asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");
        asAdmin()
                .queryParam("organization", organizationId)
                .queryParam("limit", 50)
                .get("/api/v1/audit-events")
                .then()
                .statusCode(200)
                .body(
                        "findAll { it.action.startsWith('permissions.') }.action",
                        contains(
                                "permissions.profile.deleted",
                                "permissions.exception.revoked",
                                "permissions.exception.granted",
                                "permissions.team.revoked",
                                "permissions.team.granted",
                                "permissions.profile.assigned",
                                "permissions.profile.changed",
                                "permissions.profile.created"))
                .body("findAll { it.action.startsWith('permissions.') }.actor", everyItem(equalTo(boss)))
                .body("find { it.action == 'permissions.exception.granted' }.subject", equalTo(ada))
                .body(
                        "find { it.action == 'permissions.exception.granted' }.detail",
                        equalTo("{\"permission\":\"" + CREATE + "\"}"))
                .body("find { it.action == 'permissions.team.granted' }.subject", equalTo("team/" + roads))
                .body(
                        "find { it.action == 'permissions.profile.changed' }.detail",
                        containsString("\"removed\":[\"" + CREATE + "\"]"));
    }

    private static int permissionEvents(String organizationId) {
        List<String> actions = asAdmin()
                .queryParam("organization", organizationId)
                .queryParam("limit", 500)
                .get("/api/v1/audit-events")
                .path("action");
        return (int) actions.stream()
                .filter(action -> action.startsWith("permissions."))
                .count();
    }
}
