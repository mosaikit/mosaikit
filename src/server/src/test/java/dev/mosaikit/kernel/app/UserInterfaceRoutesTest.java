// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.startsWith;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@QuarkusTest
@Tag("MK-008")
class UserInterfaceRoutesTest {

    @Test
    void servesTheIndexAtTheRoot() {
        anonymous()
                .get("/")
                .then()
                .statusCode(200)
                .contentType(startsWith("text/html"))
                .header("Cache-Control", equalTo("no-cache"))
                .body(containsString("<mk-shell>"));
    }

    @Test
    void answersDeepLinksWithTheIndexSoThatTheShellCanRouteThem() {
        anonymous().get("/app/notes").then().statusCode(200).body(containsString("<mk-shell>"));
    }

    @Test
    void servesHashedAssetsWithALongCache() {
        anonymous()
                .get("/assets/index-abc123.js")
                .then()
                .statusCode(200)
                .contentType(startsWith("text/javascript"))
                .header("Cache-Control", containsString("immutable"))
                .header("X-Content-Type-Options", "nosniff");
    }

    @Test
    @Tag("MK-014")
    void servesTheRuntimeOfIsolatedFrontendsToFramesOfAnyOrigin() {
        anonymous()
                .get("/frame.js")
                .then()
                .statusCode(200)
                .contentType(startsWith("text/javascript"))
                .header("Access-Control-Allow-Origin", "*");
    }

    @Test
    void answersNotFoundForMissingFilesInsteadOfTheIndex() {
        anonymous().get("/assets/missing.js").then().statusCode(404);
    }

    @Test
    void neverServesFilesOutsideTheDirectory() {
        anonymous().get("/..%2F..%2Fpom.xml").then().statusCode(404);
        anonymous().get("/%2e%2e/%2e%2e/pom.xml").then().statusCode(404);
    }

    @Test
    void leavesTheApiAndTheManagementEndpointsToTheKernel() {
        anonymous().get("/api/v1/system/info").then().statusCode(200).contentType(startsWith("application/json"));
        anonymous().get("/api/v1/unknown").then().statusCode(404).body(not(containsString("<mk-shell>")));
        anonymous().get("/q/health/ready").then().statusCode(200);
    }
}
