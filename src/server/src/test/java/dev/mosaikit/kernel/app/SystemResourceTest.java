// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.startsWith;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@QuarkusTest
@Tag("MK-001")
class SystemResourceTest {

    @Test
    void publishesProductInformationWithoutAuthentication() {
        anonymous()
                .get("/api/v1/system/info")
                .then()
                .statusCode(200)
                .body("name", equalTo("Mosaikit"))
                .body("version", startsWith("0.1.0"))
                .body("activePlugins", equalTo(2))
                .body("theme", equalTo("mosaikit"))
                .body("rememberDays", equalTo(30));
    }

    @Test
    void exposesHealthAndOpenApi() {
        anonymous().get("/q/health/ready").then().statusCode(200);
        anonymous().get("/q/openapi").then().statusCode(200);
    }

    @Test
    void addsSecurityHeaders() {
        anonymous()
                .get("/api/v1/system/info")
                .then()
                .header("X-Content-Type-Options", "nosniff")
                .header("X-Frame-Options", "DENY");
    }
}
