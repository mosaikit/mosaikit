// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@QuarkusTest
@Tag("MK-006")
class ExtensionResourceTest {

    @Test
    @Tag("MK-025")
    void listsInstalledExtensionsWithTheirStatus() {
        asAdmin()
                .get("/api/v1/extensions")
                .then()
                .statusCode(200)
                .body("$", hasSize(4))
                .body("find { it.id == 'dev.mosaikit.test.hello' }.status", equalTo("ACTIVE"))
                .body("find { it.id == 'dev.mosaikit.test.schema' }.status", equalTo("ACTIVE"))
                .body("find { it.id == 'dev.mosaikit.test.future' }.status", equalTo("INCOMPATIBLE"))
                // The test extension hello still contributes to launcher.app (MK-025).
                .body(
                        "find { it.id == 'dev.mosaikit.test.hello' }.warnings[0]",
                        containsString("launcher.app is deprecated"))
                .body("find { it.id == 'dev.mosaikit.test.schema' }.warnings", hasSize(0));
    }

    @Test
    @Tag("MK-011")
    void keepsJavaExtensionsInactiveWhenTheKernelIsNotStartedByTheLauncher() {
        asAdmin()
                .get("/api/v1/extensions")
                .then()
                .statusCode(200)
                .body("find { it.id == 'dev.mosaikit.test.java' }.status", equalTo("RESTART_REQUIRED"))
                .body(
                        "find { it.id == 'dev.mosaikit.test.java' }.problems[0]",
                        containsString("the mosaikit launcher"));
    }

    @Test
    void givesTheShellOnlyActiveFrontends() {
        asAdmin()
                .get("/api/v1/shell/extensions")
                .then()
                .statusCode(200)
                .body("$", hasSize(1))
                .body("[0].entry", equalTo("/api/v1/extension-assets/dev.mosaikit.test.hello/web/index.js"))
                .body("[0].contributions[0].point", equalTo("launcher.app"))
                .body("[0].contributions[0].attributes.route", equalTo("/app/hello"))
                // Test extensions are directories, loaded as modules in tests (MK-014).
                .body("[0].isolation", equalTo("module"))
                .body("[0].bridge.publishes", hasSize(0));

        anonymous().get("/api/v1/shell/extensions").then().statusCode(401);
        // Not watched outside development mode: the shell does not follow a revision.
        asAdmin().get("/api/v1/shell/extensions/revision").then().statusCode(204);
    }

    @Test
    @Tag("MK-007")
    void servesAssetsOfActiveExtensionsOnly() {
        anonymous()
                .get("/api/v1/extension-assets/dev.mosaikit.test.hello/web/index.js")
                .then()
                .statusCode(200)
                .contentType(containsString("text/javascript"))
                .header("X-Content-Type-Options", "nosniff")
                // Loaded by isolated frontends, whose frames have an opaque origin (MK-014).
                .header("Access-Control-Allow-Origin", "*");

        anonymous()
                .get("/api/v1/extension-assets/dev.mosaikit.test.hello/manifest.yaml")
                .then()
                .statusCode(404);
        anonymous()
                .get("/api/v1/extension-assets/dev.mosaikit.test.hello/..%2F..%2Fpom.xml")
                .then()
                .statusCode(not(equalTo(200)));
        anonymous()
                .get("/api/v1/extension-assets/dev.mosaikit.test.future/anything.js")
                .then()
                .statusCode(404);
    }
}
