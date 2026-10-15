// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.hamcrest.Matchers.anEmptyMap;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;
import static org.hamcrest.Matchers.startsWith;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.specification.RequestSpecification;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The branding of an organization, set by its administrators and shown before and after sign-in (MK-074). */
@QuarkusTest
@Tag("MK-074")
class BrandingTest {

    static final String PASSWORD = "a long enough password";
    static final byte[] PNG = {
        (byte) 0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 'I', 'H', 'D', 'R', 0, 0, 0, 1
    };
    static final byte[] ICO = {0, 0, 1, 0, 1, 0, 16, 16, 0, 0, 1, 0, 32, 0};
    static final String SVG =
            "<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 8 8\"><rect width=\"8\""
                    + " height=\"8\" fill=\"#0a7\"/></svg>";

    private String acme;
    private String green;
    private String admin;
    private String member;
    private String otherAdmin;

    @BeforeEach
    void organizations() {
        acme = organization("acme");
        green = organization("green");
        admin = register(acme);
        member = register(acme);
        otherAdmin = register(green);
        administrator(acme, admin);
        administrator(green, otherAdmin);
    }

    private static String organization(String name) {
        String slug = unique(name);
        asAdmin()
                .body(Map.of("slug", slug, "name", name, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String slug) {
        String email = unique("brand") + "@example.org";
        anonymous()
                .body(Map.of("organization", slug, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static void administrator(String slug, String email) {
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", slug, email)
                .then()
                .statusCode(200);
    }

    private static RequestSpecification in(String person, String slug) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", slug);
    }

    private static RequestSpecification image(RequestSpecification request, String type, byte[] content) {
        return request.contentType(type).body(content);
    }

    private static Map<String, Object> branding() {
        return Map.of(
                "displayName",
                "Acme Works",
                "accent",
                "#0A7A55",
                "light",
                Map.of("surface", "#fafafa"),
                "dark",
                Map.of("background", "#101820"));
    }

    @Test
    void anAdministratorOfTheOrganizationSetsItsImagesNameAndAccentColor() {
        in(admin, acme)
                .body(branding())
                .put("/api/v1/organizations/{slug}/branding", acme)
                .then()
                .statusCode(200)
                .body("displayName", equalTo("Acme Works"))
                .body("accent", equalTo("#0a7a55"))
                .body("light.surface", equalTo("#fafafa"))
                .body("dark.background", equalTo("#101820"));
        image(in(admin, acme), "image/png", PNG)
                .put("/api/v1/organizations/{slug}/branding/images/logo", acme)
                .then()
                .statusCode(200)
                .body("logo", startsWith("/api/v1/organizations/" + acme + "/branding/images/logo?v="));
        image(in(admin, acme), "image/svg+xml", SVG.getBytes(StandardCharsets.UTF_8))
                .put("/api/v1/organizations/{slug}/branding/images/logo-dark", acme)
                .then()
                .statusCode(200);
        image(in(admin, acme), "image/png", PNG)
                .put("/api/v1/organizations/{slug}/branding/images/icon", acme)
                .then()
                .statusCode(200);
        image(in(admin, acme), "image/x-icon", ICO)
                .put("/api/v1/organizations/{slug}/branding/images/favicon", acme)
                .then()
                .statusCode(200)
                .body("icon", containsString("/branding/images/icon?v="))
                .body("favicon", containsString("/branding/images/favicon?v="));
        asAdmin()
                .get("/api/v1/audit-events?limit=50")
                .then()
                .body("action", hasItem("organization.branding.changed"))
                .body("action", hasItem("organization.branding.image.stored"));

        // Files of the kernel, not of an extension: never offered for removal as those of one.
        asAdmin()
                .get("/api/v1/platform/files/removals")
                .then()
                .statusCode(200)
                .body("uninstalled.extension", not(hasItem("kernel")));
        asAdmin()
                .post("/api/v1/platform/files/removals/extensions/kernel")
                .then()
                .statusCode(409);

        // Replaced, then removed: the shell shows the image of the installation again.
        image(in(admin, acme), "image/svg+xml", SVG.getBytes(StandardCharsets.UTF_8))
                .put("/api/v1/organizations/{slug}/branding/images/icon", acme)
                .then()
                .statusCode(200);
        in(admin, acme)
                .delete("/api/v1/organizations/{slug}/branding/images/icon", acme)
                .then()
                .statusCode(200)
                .body("icon", nullValue());
        anonymous()
                .get("/api/v1/organizations/{slug}/branding/images/icon", acme)
                .then()
                .statusCode(404);
    }

    @Test
    void noOtherMemberChangesTheBranding() {
        in(member, acme)
                .body(branding())
                .put("/api/v1/organizations/{slug}/branding", acme)
                .then()
                .statusCode(403);
        image(in(member, acme), "image/png", PNG)
                .put("/api/v1/organizations/{slug}/branding/images/logo", acme)
                .then()
                .statusCode(403);
        // The administrator of another organization, and the platform administrator, neither.
        in(otherAdmin, green)
                .body(branding())
                .put("/api/v1/organizations/{slug}/branding", acme)
                .then()
                .statusCode(403);
        asAdmin()
                .body(branding())
                .put("/api/v1/organizations/{slug}/branding", acme)
                .then()
                .statusCode(403);
        anonymous()
                .body(branding())
                .put("/api/v1/organizations/{slug}/branding", acme)
                .then()
                .statusCode(401);
    }

    @Test
    void refusesImagesOver2MegabytesAndContentThatIsNotAnImage() {
        byte[] large = Arrays.copyOf(PNG, 2 * 1024 * 1024 + 1);
        image(in(admin, acme), "image/png", large)
                .put("/api/v1/organizations/{slug}/branding/images/logo", acme)
                .then()
                .statusCode(413);
        byte[] exactly = Arrays.copyOf(PNG, 2 * 1024 * 1024);
        image(in(admin, acme), "image/png", exactly)
                .put("/api/v1/organizations/{slug}/branding/images/logo", acme)
                .then()
                .statusCode(200);
        image(in(admin, acme), "image/png", "<html>not an image</html>".getBytes(StandardCharsets.UTF_8))
                .put("/api/v1/organizations/{slug}/branding/images/logo", acme)
                .then()
                .statusCode(400);
        String script = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>";
        image(in(admin, acme), "image/svg+xml", script.getBytes(StandardCharsets.UTF_8))
                .put("/api/v1/organizations/{slug}/branding/images/logo", acme)
                .then()
                .statusCode(400);
        image(in(admin, acme), "image/png", PNG)
                .put("/api/v1/organizations/{slug}/branding/images/banner", acme)
                .then()
                .statusCode(404);
        in(admin, acme)
                .body(Map.of("accent", "red"))
                .put("/api/v1/organizations/{slug}/branding", acme)
                .then()
                .statusCode(400);
        in(admin, acme)
                .body(Map.of("light", Map.of("script", "#000000")))
                .put("/api/v1/organizations/{slug}/branding", acme)
                .then()
                .statusCode(400);
    }

    @Test
    void theSignInPageOfTheOrganizationAndItsMembersSeeItsBrandingOthersDoNot() {
        in(admin, acme).body(branding()).put("/api/v1/organizations/{slug}/branding", acme);
        image(in(admin, acme), "image/svg+xml", SVG.getBytes(StandardCharsets.UTF_8))
                .put("/api/v1/organizations/{slug}/branding/images/logo", acme)
                .then()
                .statusCode(200);

        // Before sign-in, on the sign-in page of the organization.
        String logo = anonymous()
                .get("/api/v1/organizations/{slug}/branding", acme)
                .then()
                .statusCode(200)
                .body("displayName", equalTo("Acme Works"))
                .body("accent", equalTo("#0a7a55"))
                .extract()
                .path("logo");
        // Served by the installation itself, as the policy of the shell allows images (MK-128), and
        // never run when opened alone.
        anonymous()
                .get(logo)
                .then()
                .statusCode(200)
                .contentType(startsWith("image/svg+xml"))
                .header("Content-Security-Policy", containsString("sandbox"))
                .header("X-Content-Type-Options", equalTo("nosniff"));

        // After sign-in: the members of the organization read it, those of another read their own.
        in(member, acme)
                .get("/api/v1/organizations/{slug}/branding", acme)
                .then()
                .statusCode(200)
                .body("displayName", equalTo("Acme Works"));
        in(otherAdmin, green)
                .get("/api/v1/organizations/{slug}/branding", green)
                .then()
                .statusCode(200)
                .body("displayName", nullValue())
                .body("logo", nullValue());
        // An organization that does not exist answers as one without branding.
        anonymous()
                .get("/api/v1/organizations/{slug}/branding", unique("nowhere"))
                .then()
                .statusCode(200)
                .body("displayName", nullValue())
                .body("light", anEmptyMap());
    }
}
