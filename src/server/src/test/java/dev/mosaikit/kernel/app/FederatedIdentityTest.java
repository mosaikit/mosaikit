// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.KeycloakTestResource.ACME;
import static dev.mosaikit.kernel.app.KeycloakTestResource.GLOBEX;
import static dev.mosaikit.kernel.app.KeycloakTestResource.email;
import static dev.mosaikit.kernel.app.KeycloakTestResource.token;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.nullValue;

import io.quarkus.test.common.WithTestResource;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.specification.RequestSpecification;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** Sign-in through the Keycloak realm of each organization (MK-012), against a real Keycloak. */
@QuarkusTest
@WithTestResource(KeycloakTestResource.class)
@Tag("keycloak")
@Tag("MK-012")
class FederatedIdentityTest {

    private static final String LOCAL_PASSWORD = "a long enough password";

    @BeforeEach
    void createOrganizations() {
        for (String realm : List.of(ACME, GLOBEX)) {
            asAdmin()
                    .body(Map.of("slug", realm, "name", realm, "selfRegistration", true))
                    .post("/api/v1/organizations");
            asAdmin()
                    .body(Map.of("realm", realm, "emailDomains", List.of(realm + ".test")))
                    .put("/api/v1/organizations/{slug}/identity", realm)
                    .then()
                    .statusCode(200);
        }
    }

    private static String host(String organization) {
        return organization + ".mosaikit.test";
    }

    private static RequestSpecification bearer(String token) {
        return given().auth().oauth2(token);
    }

    @Test
    void choosesTheRealmFromTheEmailDomain() {
        anonymous()
                .queryParam("email", "Someone@" + ACME.toUpperCase() + ".test")
                .get("/api/v1/identity/sign-in-options")
                .then()
                .statusCode(200)
                .body("organization", equalTo(ACME))
                .body("federation.issuer", equalTo(KeycloakTestResource.url + "/realms/" + ACME))
                .body("federation.clientId", equalTo("mosaikit"));

        anonymous()
                .queryParam("email", "someone@unknown.example")
                .get("/api/v1/identity/sign-in-options")
                .then()
                .statusCode(200)
                .body("organization", nullValue())
                .body("federation", nullValue());
    }

    @Test
    void choosesTheRealmFromTheSubDomain() {
        anonymous()
                .header("Host", host(GLOBEX))
                .queryParam("email", "someone@unknown.example")
                .get("/api/v1/identity/sign-in-options")
                .then()
                .statusCode(200)
                .body("organization", equalTo(GLOBEX))
                .body("federation.issuer", equalTo(KeycloakTestResource.url + "/realms/" + GLOBEX));
    }

    @Test
    void signsInWithATokenOfTheRealmAndGrantsOnlyKernelRoles() {
        String organizationId =
                asAdmin().get("/api/v1/organizations/{slug}", ACME).path("id");

        bearer(token(ACME, "alice"))
                .header("Host", host(ACME))
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(200)
                .body("username", equalTo(email("alice", ACME)))
                .body("displayName", equalTo("Alice Tester"))
                .body("organizationId", equalTo(organizationId))
                .body("roles", containsInAnyOrder("organization-admin", "organization-user"));

        // The realm role platform-admin is not a kernel role.
        bearer(token(ACME, "alice")).get("/api/v1/organizations").then().statusCode(403);

        bearer(token(ACME, "bob"))
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(200)
                .body("roles", containsInAnyOrder("organization-user"));
    }

    @Test
    void acceptsOnTheSubDomainOfAnOrganizationOnlyTokensOfItsRealm() {
        String gina = token(GLOBEX, "gina");

        bearer(gina)
                .header("Host", host(ACME))
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(401);
        bearer(gina)
                .header("Host", host(GLOBEX))
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(200);
        // Outside the sub-domains the issuer of the token chooses the realm.
        bearer(gina).get("/api/v1/accounts/me").then().statusCode(200).body("username", equalTo(email("gina", GLOBEX)));
    }

    @Test
    void refusesForgedAndForeignTokens() {
        String alice = token(ACME, "alice");
        String[] parts = alice.split("\\.");
        String forged = parts[0] + "." + parts[1] + "." + parts[2].substring(0, parts[2].length() - 4) + "AAAA";

        bearer(forged).get("/api/v1/accounts/me").then().statusCode(401);
        bearer("not-a-token").get("/api/v1/accounts/me").then().statusCode(401);
    }

    @Test
    void linksALocalAccountWithTheSameVerifiedEmailInTheSameOrganization() {
        String carol = email("carol", ACME);
        String localId = anonymous()
                .body(Map.of(
                        "organization", ACME,
                        "email", carol,
                        "displayName", "Carol",
                        "password", LOCAL_PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201)
                .extract()
                .path("id");

        bearer(token(ACME, "carol"))
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(200)
                .body("id", equalTo(localId));
        // The local password keeps working, for example when Keycloak is down.
        as(carol, LOCAL_PASSWORD)
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(200)
                .body("id", equalTo(localId));

        // Another realm can never take over the account, even with a verified address.
        bearer(token(GLOBEX, "intruder")).get("/api/v1/accounts/me").then().statusCode(401);
    }

    @Test
    void keepsLocalSignInAndRefusesPasswordsOfFederatedAccounts() {
        asAdmin().get("/api/v1/accounts/me").then().statusCode(200);

        bearer(token(ACME, "bob")).get("/api/v1/accounts/me").then().statusCode(200);
        // A federated account has no local password.
        as(email("bob", ACME), "").get("/api/v1/accounts/me").then().statusCode(401);
    }
}
