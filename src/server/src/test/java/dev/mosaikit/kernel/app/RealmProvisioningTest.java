// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.matchesPattern;
import static org.hamcrest.Matchers.not;

import com.fasterxml.jackson.databind.JsonNode;
import io.quarkus.test.common.WithTestResource;
import io.quarkus.test.junit.QuarkusTest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The kernel creates the Keycloak realm of a new organization (MK-018), on a real Keycloak. */
@QuarkusTest
@WithTestResource(KeycloakTestResource.class)
@Tag("keycloak")
@Tag("MK-018")
class RealmProvisioningTest {

    private static Map<String, Object> organization(String slug, Map<String, Object> federation) {
        return Map.of("slug", slug, "name", "Organization " + slug, "federation", federation);
    }

    @Test
    void createsTheRealmWithTheClientTheRoleAndAFirstManager() {
        String slug = unique("prov");
        KeycloakTestResource.CREATED_BY_TESTS.add(slug);
        String email = "Ada@" + slug + ".test";

        asAdmin()
                .body(organization(
                        slug,
                        Map.of(
                                "emailDomains",
                                List.of(slug + ".test"),
                                "administrator",
                                Map.of("email", email, "firstName", "Ada", "lastName", "Lovelace"))))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201)
                .body("identityRealm", equalTo(slug))
                .body("emailDomains", contains(slug + ".test"))
                .body("initialAdministrator.username", equalTo(email.toLowerCase()))
                .body("initialAdministrator.temporaryPassword", matchesPattern("[A-Za-z0-9_-]{20}"));

        // The realm exists, with the client of the kernel UI and its redirect addresses.
        JsonNode client = KeycloakTestResource.admin("/admin/realms/" + slug + "/clients?clientId=mosaikit")
                .get(0);
        assertThat(client.path("publicClient").asBoolean()).isTrue();
        assertThat(client.path("attributes").path("pkce.code.challenge.method").asText())
                .isEqualTo("S256");
        List<String> redirects = new ArrayList<>();
        client.path("redirectUris").forEach(uri -> redirects.add(uri.asText()));
        assertThat(redirects)
                .anySatisfy(uri -> assertThat(uri).startsWith("http://localhost:"))
                .anySatisfy(uri -> assertThat(uri).matches("http://" + slug + "\\.mosaikit\\.test:\\d+/\\*"));

        // The first manager has the manager role and must change the password at the first sign-in.
        JsonNode user = KeycloakTestResource.admin("/admin/realms/" + slug + "/users?username=" + email.toLowerCase())
                .get(0);
        assertThat(user.path("requiredActions").toString()).contains("UPDATE_PASSWORD");
        JsonNode roles = KeycloakTestResource.admin(
                "/admin/realms/" + slug + "/users/" + user.path("id").asText() + "/role-mappings/realm");
        assertThat(roles.findValuesAsText("name")).contains("organization-admin");

        // People of the organization are sent to the new realm at once.
        anonymous()
                .queryParam("email", "someone@" + slug + ".test")
                .get("/api/v1/identity/sign-in-options")
                .then()
                .statusCode(200)
                .body("federation.issuer", equalTo(KeycloakTestResource.url + "/realms/" + slug));

        // The temporary password is returned only when the realm is created.
        asAdmin()
                .get("/api/v1/organizations/{slug}", slug)
                .then()
                .statusCode(200)
                .body("$", not(hasKey("initialAdministrator")));
    }

    @Test
    void createsNoOrganizationWhenTheRealmCannotBeCreated() {
        String slug = unique("taken");
        KeycloakTestResource.CREATED_BY_TESTS.add(slug);
        KeycloakTestResource.createEmptyRealm(slug);

        asAdmin()
                .body(organization(slug, Map.of("emailDomains", List.of(slug + ".test"))))
                .post("/api/v1/organizations")
                .then()
                .statusCode(409);

        asAdmin().get("/api/v1/organizations/{slug}", slug).then().statusCode(404);
        anonymous()
                .queryParam("email", "someone@" + slug + ".test")
                .get("/api/v1/identity/sign-in-options")
                .then()
                .body("organization", equalTo(null));
    }
}
