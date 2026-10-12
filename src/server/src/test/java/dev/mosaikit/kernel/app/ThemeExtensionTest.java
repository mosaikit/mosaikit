// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;
import static org.hamcrest.Matchers.startsWith;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import java.nio.file.Path;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The themes of theme extensions, for the shell (MK-028). */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-028")
class ThemeExtensionTest {

    static final Path EXTENSIONS = TestExtensions.EXTENSIONS;

    @Test
    void offersTheThemesOfActiveThemeExtensionsBeforeSignIn() {
        anonymous()
                .get("/api/v1/system/themes")
                .then()
                .statusCode(200)
                // The broken one is not active: its manifest is invalid.
                .body("$", hasSize(1))
                .body("[0].id", equalTo("dev.mosaikit.test.green"))
                .body("[0].title", equalTo("Green"))
                .body("[0].light.brand", equalTo("#1b6e3c"))
                .body("[0].dark.size()", equalTo(0))
                .body("[0].radius", nullValue());
        // The installation names it as its theme.
        anonymous().get("/api/v1/system/info").then().body("theme", equalTo("dev.mosaikit.test.green"));
    }

    @Test
    @Tag("MK-052")
    void theThemeOfTheInstallationNamesTheProductAndBringsItsLogo() {
        String logo = "/api/v1/extension-assets/dev.mosaikit.test.green/web/logo.svg";
        anonymous()
                .get("/api/v1/system/info")
                .then()
                .statusCode(200)
                .body("name", equalTo("Green Works"))
                .body("logo", equalTo(logo))
                // Without a logo for dark backgrounds, the one for light backgrounds.
                .body("logoDark", equalTo(logo));
        // The logo is there before sign-in, for the sign-in page.
        anonymous().get(logo).then().statusCode(200).contentType(startsWith("image/svg+xml"));
    }
}
