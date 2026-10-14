// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;

import dev.mosaikit.kernel.api.permission.PermissionHolders;
import dev.mosaikit.kernel.core.identity.OrganizationAccess;
import dev.mosaikit.kernel.core.jobs.OrganizationJobs;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.arc.Arc;
import io.quarkus.arc.ManagedContext;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.security.identity.CurrentIdentityAssociation;
import io.quarkus.security.runtime.QuarkusPrincipal;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.ValidatableResponse;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import org.eclipse.microprofile.config.Config;
import org.eclipse.microprofile.config.ConfigProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Who holds a permission in the organization (MK-056), for an extension that translates its
 * permissions into the rules of another server: through {@code PermissionHolders}, by the same rules
 * as {@code Permissions}, and through the published view {@code mk_published.permission_holder}
 * (MK-123).
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-056")
@Tag("MK-123")
class PermissionHoldersTest {

    static final String EXTENSION = PermissionsTest.EXTENSION;
    static final String CREATE = PermissionsTest.CREATE;
    static final String VIEW = PermissionsTest.VIEW;
    static final String TODO = PermissionsTest.TODO;
    static final String PASSWORD = "a long enough password";

    @Inject
    PermissionHolders holders;

    private String acme;
    private String globex;
    private String boss;
    private String ada;
    private String bea;
    private String dora;
    private String eva;
    private String cleo;
    private String roads;

    @BeforeEach
    void organization() {
        acme = organization("holders");
        globex = organization("holders-other");
        boss = register(acme);
        ada = register(acme);
        bea = register(acme);
        dora = register(acme);
        eva = register(acme);
        cleo = register(globex);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", acme, boss)
                .then()
                .statusCode(200);

        // Bea and Eva get the default profile; Ada and Dora a profile of their own.
        profile("Everyone", "organization-user", VIEW);
        assign(ada, profile("Builders", null, CREATE));
        assign(dora, profile("Nothing", null));
        // Cleo, a guest, through a team; Eva through an exception.
        roads = in(boss).body(Map.of("name", "Roads", "visibility", "private"))
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
        in(boss).body(Map.of("role", "guest"))
                .put("/api/v1/teams/" + roads + "/members/" + cleo)
                .then()
                .statusCode(200);
        in(boss).put(admin() + "/teams/{id}/{permission}", roads, CREATE).then().statusCode(200);
        in(boss).put(admin() + "/members/{email}/exceptions/{permission}", eva, CREATE)
                .then()
                .statusCode(200);
    }

    private static String organization(String prefix) {
        String slug = unique(prefix);
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("holders") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private RequestSpecification in(String person) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", acme);
    }

    private String admin() {
        return "/api/v1/organizations/" + acme + "/permissions";
    }

    private String profile(String name, String defaultForRole, String... permissions) {
        Map<String, Object> body = new HashMap<>(Map.of("name", name, "permissions", List.of(permissions)));
        if (defaultForRole != null) {
            body.put("defaultForRole", defaultForRole);
        }
        return in(boss).body(body)
                .post(admin() + "/profiles")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
    }

    private void assign(String person, String profile) {
        in(boss).body(Map.of("profile", profile))
                .put(admin() + "/members/{email}/profile", person)
                .then()
                .statusCode(200);
    }

    private ValidatableResponse holdersOf(String person, String qualified) {
        String[] parts = qualified.split(":");
        return in(person)
                .get("/api/v1/test/permission-holders/{extension}/{permission}", parts[0], parts[1])
                .then();
    }

    private static String sorted(String... people) {
        return String.join(",", Arrays.stream(people).sorted().toList());
    }

    private static UUID id(String path) {
        return UUID.fromString(asAdmin().get(path).path("id"));
    }

    private static Connection reader() throws SQLException {
        Config config = ConfigProvider.getConfig();
        return DriverManager.getConnection(
                config.getValue("quarkus.datasource.jdbc.url", String.class),
                "mk_test_published",
                "test-published-password");
    }

    /** The rows of the published view for a permission of an organization, as source:username-or-team. */
    private static List<String> published(String organization, String qualified) throws SQLException {
        String[] parts = qualified.split(":");
        try (Connection reader = reader();
                PreparedStatement statement = reader.prepareStatement("""
                        select h.source, coalesce(a.username, h.team_id::text)
                        from mk_published.permission_holder h
                        join mk_published.organization o on o.id = h.organization_id
                        left join mk_published.account a on a.id = h.account_id
                        where o.slug = ? and h.extension_id = ? and h.permission = ?
                        order by 1, 2""")) {
            statement.setString(1, organization);
            statement.setString(2, parts[0]);
            statement.setString(3, parts[1]);
            List<String> rows = new ArrayList<>();
            try (ResultSet result = statement.executeQuery()) {
                while (result.next()) {
                    rows.add(result.getString(1) + ":" + result.getString(2));
                }
            }
            return rows;
        }
    }

    /** Runs work outside the context of the test, with an identity of its own, as a request would. */
    private static <T> T with(QuarkusSecurityIdentity identity, Callable<T> work) {
        return CompletableFuture.supplyAsync(() -> {
                    try {
                        return OrganizationJobs.outsideRequests(() -> {
                            ManagedContext requests = Arc.container().requestContext();
                            requests.activate();
                            try {
                                Arc.container()
                                        .instance(CurrentIdentityAssociation.class)
                                        .get()
                                        .setIdentity(identity);
                                return QuarkusTransaction.requiringNew().call(work);
                            } finally {
                                requests.terminate();
                            }
                        });
                    } catch (Exception e) {
                        throw new IllegalStateException(e);
                    }
                })
                .join();
    }

    @Test
    void theHoldersOfAPermissionAreThoseThePermissionsBeanAnswersFor() {
        holdersOf(dora, CREATE)
                .statusCode(200)
                .body("permission", equalTo(CREATE))
                // The administrator, Ada by her profile, Cleo by her team as a guest, Eva by exception.
                .body("people.join(',')", equalTo(sorted(boss, ada, cleo, eva)))
                .body("teams", contains(roads));
        holdersOf(dora, VIEW)
                .statusCode(200)
                // The default profile reaches Bea and Eva, not Ada nor Dora who have one of their own,
                // and never the guest.
                .body("people.join(',')", equalTo(sorted(boss, bea, eva)))
                .body("teams", empty());

        // The same answer as the Permissions bean gives each of them.
        for (String person : List.of(boss, ada, bea, dora, eva)) {
            boolean holds = in(person)
                            .get(
                                    "/api/v1/test/permissions/require/{extension}/{permission}",
                                    EXTENSION,
                                    "create-dashboard")
                            .statusCode()
                    == 204;
            assertThat(holds).as(person).isEqualTo(List.of(boss, ada, eva).contains(person));
        }

        // A change shows at once: the team loses the permission.
        in(boss).delete(admin() + "/teams/{id}/{permission}", roads, CREATE)
                .then()
                .statusCode(200);
        holdersOf(dora, CREATE)
                .body("people.join(',')", equalTo(sorted(boss, ada, eva)))
                .body("teams", empty());
    }

    @Test
    void nobodyHoldsAnUndeclaredPermissionNorOneOfAnExtensionTurnedOff() {
        holdersOf(dora, EXTENSION + ":delete-everything")
                .statusCode(200)
                .body("people", empty())
                .body("teams", empty());
        in(dora).get("/api/v1/test/permission-holders/dev.example.absent/x")
                .then()
                .statusCode(400);

        in(boss).put(admin() + "/members/{email}/exceptions/{permission}", ada, PermissionsTest.ADD_ITEM)
                .then()
                .statusCode(200);
        holdersOf(dora, PermissionsTest.ADD_ITEM).body("people.join(',')", equalTo(sorted(boss, ada)));
        in(boss).body(List.of(Map.of(
                        "extensionId", TODO, "appId", "todo", "enabled", false, "pinned", false, "roles", List.of())))
                .put("/api/v1/organizations/{slug}/apps", acme)
                .then()
                .statusCode(200);
        holdersOf(dora, PermissionsTest.ADD_ITEM).body("people", empty());
    }

    @Test
    void aGuestReadsOnlyTheHoldersOfTheirTeams() {
        UUID organization = id("/api/v1/organizations/" + acme);
        UUID account = UUID.fromString(in(boss).get("/api/v1/teams/" + roads)
                .then()
                .statusCode(200)
                .extract()
                .path("members.find { it.email == '" + cleo + "' }.account"));
        QuarkusSecurityIdentity guest = QuarkusSecurityIdentity.builder()
                .setPrincipal(new QuarkusPrincipal(cleo))
                .addRole(Roles.ORGANIZATION_GUEST)
                .addAttribute(OrganizationAccess.ORGANIZATION_ATTRIBUTE, organization.toString())
                .addAttribute(OrganizationAccess.ACCOUNT_ATTRIBUTE, account.toString())
                .build();

        PermissionHolders.Holders seen = with(guest, () -> holders.of(EXTENSION, "create-dashboard"));

        // Boss, the owner of Roads, and Cleo herself; not Ada nor Eva, who are not in her teams.
        assertThat(seen.people()).hasSize(2).contains(account);
        assertThat(seen.teams()).containsExactly(UUID.fromString(roads));
    }

    @Test
    void thePublishedViewListsWhoHoldsAPermissionByProfileExceptionAndTeam() throws SQLException {
        assertThat(published(acme, CREATE))
                .containsExactlyInAnyOrder("exception:" + eva, "profile:" + ada, "team:" + roads);
        // The default profile, but not for those who have one of their own, and never for a guest.
        assertThat(published(acme, VIEW)).containsExactlyInAnyOrder("profile:" + bea, "profile:" + eva);
        assertThat(published(globex, CREATE)).isEmpty();

        // An extension whose apps are all off gives nothing.
        in(boss).put(admin() + "/members/{email}/exceptions/{permission}", ada, PermissionsTest.ADD_ITEM)
                .then()
                .statusCode(200);
        assertThat(published(acme, PermissionsTest.ADD_ITEM)).containsExactly("exception:" + ada);
        in(boss).body(List.of(Map.of(
                        "extensionId", TODO, "appId", "todo", "enabled", false, "pinned", false, "roles", List.of())))
                .put("/api/v1/organizations/{slug}/apps", acme)
                .then()
                .statusCode(200);
        assertThat(published(acme, PermissionsTest.ADD_ITEM)).isEmpty();
        in(boss).body(List.of())
                .put("/api/v1/organizations/{slug}/apps", acme)
                .then()
                .statusCode(200);
        assertThat(published(acme, PermissionsTest.ADD_ITEM)).containsExactly("exception:" + ada);
    }

    @Test
    void theHoldersAreTheSameForAJobWithoutAPerson() {
        UUID organization = id("/api/v1/organizations/" + acme);
        PermissionHolders.Holders found = CompletableFuture.supplyAsync(() -> {
                    try {
                        return Arc.container()
                                .instance(OrganizationJobs.class)
                                .get()
                                .run(EXTENSION, organization, () -> holders.of(EXTENSION, "create-dashboard"));
                    } catch (Exception e) {
                        throw new IllegalStateException(e);
                    }
                })
                .join();
        assertThat(found.people()).hasSize(4);
        assertThat(found.teams()).containsExactly(UUID.fromString(roads));
    }
}
