// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.notNullValue;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Extensions write the audit log of the organization through kernel-api (MK-059): the entry has the
 * person and the organization of the request, the time of the kernel and the channel EXTENSION, and the
 * administrators of the organization read and verify it with the others.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-059")
class ExtensionAuditTest {

    private static final String PASSWORD = "a long enough password";
    private static final String EXTENSION = "dev.mosaikit.test.notify";
    private static final String PROBE = "/api/v1/test/extension-audit/";

    private String acme;
    private String globex;
    private String boss;
    private String ada;

    @BeforeEach
    void people() {
        acme = organization();
        globex = organization();
        boss = register(acme);
        ada = register(acme);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", acme, boss)
                .then()
                .statusCode(200);
    }

    @Test
    void anExtensionWritesAnEntryThatAppearsInTheAuditLogOfTheOrganization() {
        Instant before = Instant.now();
        in(ada, acme)
                .body(Map.of(
                        "action", "dashboard.exported",
                        "object", "dashboard/42",
                        "details", Map.of("format", "csv")))
                .post(PROBE + EXTENSION)
                .then()
                .statusCode(204);

        String acmeId = asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");
        in(boss, acme)
                .queryParam("action", EXTENSION + ":")
                .get(events(acme))
                .then()
                .statusCode(200)
                .body("$", hasSize(1))
                .body("[0].actor", equalTo(ada))
                .body("[0].action", equalTo(EXTENSION + ":dashboard.exported"))
                .body("[0].subject", equalTo("dashboard/42"))
                .body("[0].channel", equalTo("EXTENSION"))
                .body("[0].outcome", equalTo("SUCCEEDED"))
                .body("[0].organizationId", equalTo(acmeId))
                .body("[0].detail", equalTo("{\"format\":\"csv\"}"))
                .body("[0].hash", notNullValue());
        String at = in(boss, acme)
                .queryParam("channel", "extension")
                .get(events(acme))
                .path("[0].occurredAt");
        assertThat(Instant.parse(at))
                .isBetween(before.minusSeconds(1), Instant.now().plusSeconds(1));
        in(boss, acme).get(events(acme) + "/verification").then().body("intact", equalTo(true));
        // Only in the organization of the request.
        asAdmin()
                .queryParam("action", EXTENSION + ":")
                .get(events(globex))
                .then()
                .statusCode(200)
                .body("$", hasSize(0));
    }

    @Test
    void theEntryIsKeptWhenTheWorkOfTheExtensionRollsBack() {
        in(ada, acme)
                .queryParam("rollback", true)
                .body(Map.of("action", "dashboard.deleted", "object", "dashboard/7", "outcome", "FAILED"))
                .post(PROBE + EXTENSION)
                .then()
                .statusCode(500);

        in(boss, acme)
                .queryParam("action", EXTENSION + ":dashboard.deleted")
                .get(events(acme))
                .then()
                .body("outcome", contains("FAILED"));
    }

    @Test
    void refusesAnExtensionThatIsNotActiveAndActionsThatAreNotStableNames() {
        in(ada, acme)
                .body(Map.of("action", "dashboard.exported"))
                .post(PROBE + "dev.example.unknown")
                .then()
                .statusCode(400);
        in(ada, acme)
                .body(Map.of("action", "Dashboard Exported"))
                .post(PROBE + EXTENSION)
                .then()
                .statusCode(400);
        in(ada, acme)
                .body(Map.of("action", "a".repeat(65)))
                .post(PROBE + EXTENSION)
                .then()
                .statusCode(400);
        in(ada, acme)
                .body(Map.of("action", "big", "details", Map.of("text", "x".repeat(9000))))
                .post(PROBE + EXTENSION)
                .then()
                .statusCode(400);

        in(boss, acme)
                .queryParam("channel", "EXTENSION")
                .get(events(acme))
                .then()
                .body("$", hasSize(0));
    }

    // Helpers.

    private static String events(String organization) {
        return "/api/v1/organizations/" + organization + "/audit-events";
    }

    private static String organization() {
        String slug = unique("extaudit");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("extaudit") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }
}
