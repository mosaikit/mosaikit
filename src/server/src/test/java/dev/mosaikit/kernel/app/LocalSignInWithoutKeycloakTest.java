// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.equalTo;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** With Keycloak unreachable, the kernel starts and local accounts keep signing in (MK-012). */
@QuarkusTest
@TestProfile(LocalSignInWithoutKeycloakTest.UnreachableKeycloak.class)
@Tag("MK-012")
class LocalSignInWithoutKeycloakTest {

    /** Nothing listens on port 9 of the loopback interface. */
    static final String KEYCLOAK = "http://127.0.0.1:9";

    public static class UnreachableKeycloak implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            return Map.of(
                    "mosaikit.identity.keycloak-url", KEYCLOAK,
                    "mosaikit.identity.admin.client-id", "mosaikit-admin",
                    "mosaikit.identity.admin.client-secret", "unused");
        }
    }

    @Test
    void signsInWithALocalPasswordWhileTheRealmIsUnreachable() {
        String slug = unique("offline");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        asAdmin()
                .body(Map.of("realm", slug, "emailDomains", List.of(slug + ".test")))
                .put("/api/v1/organizations/{slug}/identity", slug)
                .then()
                .statusCode(200)
                .body("identityRealm", equalTo(slug))
                .body("emailDomains[0]", equalTo(slug + ".test"));

        // The UI is still told about the realm: choosing it needs no call to Keycloak.
        anonymous()
                .queryParam("email", "ada@" + slug + ".test")
                .get("/api/v1/identity/sign-in-options")
                .then()
                .statusCode(200)
                .body("federation.issuer", equalTo(KEYCLOAK + "/realms/" + slug));

        String email = "ada@" + slug + ".test";
        anonymous()
                .body(Map.of("organization", slug, "email", email, "displayName", "Ada", "password", "a long password"))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        as(email, "a long password").get("/api/v1/accounts/me").then().statusCode(200);
        asAdmin().get("/api/v1/accounts/me").then().statusCode(200);

        // A token of the unreachable realm cannot be verified: the UI is told to retry or to use a
        // local password.
        given().auth()
                .oauth2(unsignedToken(KEYCLOAK + "/realms/" + slug))
                .get("/api/v1/accounts/me")
                .then()
                .statusCode(503)
                .contentType("application/problem+json")
                .header("Retry-After", "30");
        // Local sign-in is not affected by the failure.
        as(email, "a long password").get("/api/v1/accounts/me").then().statusCode(200);
    }

    @Test
    void refusesARealmOrAnEmailDomainOfAnotherOrganization() {
        String first = unique("first");
        String second = unique("second");
        for (String slug : List.of(first, second)) {
            asAdmin().body(Map.of("slug", slug, "name", slug)).post("/api/v1/organizations");
        }
        asAdmin()
                .body(Map.of("realm", first, "emailDomains", List.of(first + ".test")))
                .put("/api/v1/organizations/{slug}/identity", first)
                .then()
                .statusCode(200);

        asAdmin()
                .body(Map.of("realm", first, "emailDomains", List.of()))
                .put("/api/v1/organizations/{slug}/identity", second)
                .then()
                .statusCode(409);
        asAdmin()
                .body(Map.of("emailDomains", List.of(first.toUpperCase() + ".test")))
                .put("/api/v1/organizations/{slug}/identity", second)
                .then()
                .statusCode(409);
        asAdmin()
                .body(Map.of("realm", "not a realm", "emailDomains", List.of("not a domain")))
                .put("/api/v1/organizations/{slug}/identity", second)
                .then()
                .statusCode(400);
    }

    @Test
    @Tag("MK-018")
    void createsNoFederatedOrganizationWhileKeycloakIsUnreachable() {
        String slug = unique("unreachable");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "federation", Map.of("emailDomains", List.of(slug + ".test"))))
                .post("/api/v1/organizations")
                .then()
                .statusCode(503)
                .body("detail", org.hamcrest.Matchers.containsString("Keycloak cannot be reached"));

        asAdmin().get("/api/v1/organizations/{slug}", slug).then().statusCode(404);
    }

    private static String unsignedToken(String issuer) {
        var encoder = Base64.getUrlEncoder().withoutPadding();
        String header = encoder.encodeToString("{\"alg\":\"RS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
        String claims = encoder.encodeToString(
                ("{\"iss\":\"" + issuer + "\",\"sub\":\"x\",\"azp\":\"mosaikit\"}").getBytes(StandardCharsets.UTF_8));
        return header + "." + claims + "." + encoder.encodeToString(new byte[64]);
    }
}
