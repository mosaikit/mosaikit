// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.hamcrest.Matchers.endsWith;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;

import io.quarkus.test.junit.QuarkusTest;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@QuarkusTest
@Tag("MK-002")
class OrganizationResourceTest {

    @Test
    void requiresAuthentication() {
        anonymous().get("/api/v1/organizations").then().statusCode(401);
    }

    @Test
    void createsListsAndReadsAnOrganization() {
        var slug = unique("municipality");
        asAdmin()
                .body(Map.of("slug", slug, "name", "Municipality One", "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201)
                .header("Location", endsWith("/api/v1/organizations/" + slug))
                .body("slug", equalTo(slug))
                .body("selfRegistration", equalTo(true));

        asAdmin().get("/api/v1/organizations").then().statusCode(200).body("slug", hasItem(slug));
        asAdmin().get("/api/v1/organizations/" + slug).then().statusCode(200).body("name", equalTo("Municipality One"));
    }

    @Test
    @Tag("MK-010")
    void refusesADuplicateSlugWithAProblemDetail() {
        var body = Map.of("slug", unique("twin"), "name", "Twin", "selfRegistration", false);
        asAdmin().body(body).post("/api/v1/organizations").then().statusCode(201);

        asAdmin()
                .body(body)
                .post("/api/v1/organizations")
                .then()
                .statusCode(409)
                .contentType("application/problem+json")
                .body("status", equalTo(409))
                .body("title", equalTo("Conflict"));
    }

    @Test
    @Tag("MK-010")
    void validatesTheRequest() {
        asAdmin()
                .body(Map.of("slug", "Not Valid!", "name", "", "selfRegistration", false))
                .post("/api/v1/organizations")
                .then()
                .statusCode(400)
                .contentType("application/problem+json")
                .body("errors.field", hasItem("slug"))
                .body("errors.field", hasItem("name"));
    }

    @Test
    void answersNotFoundForAnUnknownSlug() {
        asAdmin().get("/api/v1/organizations/does-not-exist").then().statusCode(404);
    }

    @Test
    @Tag("MK-015")
    void auditsTheChangesOfOrganizationsAndMembers() {
        String slug = unique("audited");
        asAdmin()
                .body(Map.of("slug", slug, "name", "Audited", "selfRegistration", false))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        asAdmin()
                .body(Map.of("roles", java.util.List.of("organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", slug, "someone@example.org")
                .then()
                .statusCode(200);
        asAdmin()
                .delete("/api/v1/organizations/{slug}/members/{email}", slug, "someone@example.org")
                .then()
                .statusCode(204);

        asAdmin()
                .get("/api/v1/audit-events?limit=500")
                .then()
                .statusCode(200)
                .body("findAll { it.subject == '" + slug + "' }.action", hasItem("organization.created"))
                .body(
                        "findAll { it.subject == '" + slug + "/someone@example.org' }.action",
                        equalTo(java.util.List.of("organization.member.removed", "organization.member.updated")));
        anonymous().get("/api/v1/audit-events").then().statusCode(401);
    }
}
