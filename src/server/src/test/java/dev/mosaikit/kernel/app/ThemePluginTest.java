// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The themes of theme plugins, for the shell (MK-028). */
@QuarkusTest
@TestProfile(ThemePluginTest.ThemePlugin.class)
@Tag("MK-028")
class ThemePluginTest {

    static final Path PLUGINS = Path.of("target", "theme-test", "plugins").toAbsolutePath();

    /** A theme plugin and a broken one, as directories. */
    public static class ThemePlugin implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            try {
                Path green = Files.createDirectories(PLUGINS.resolve("green"));
                Files.writeString(green.resolve("manifest.yaml"), """
                        id: dev.mosaikit.test.green
                        version: 1.0.0
                        name: Green (test)
                        kind: [theme]
                        platform: '>=0.1 <1'
                        theme:
                          title: Green
                          light:
                            brand: '#1b6e3c'
                        """);
                Path broken = Files.createDirectories(PLUGINS.resolve("broken"));
                Files.writeString(broken.resolve("manifest.yaml"), """
                        id: dev.mosaikit.test.broken-theme
                        version: 1.0.0
                        name: Broken (test)
                        kind: [theme]
                        platform: '>=0.1 <1'
                        theme:
                          title: Broken
                          light:
                            brand: red
                        """);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
            return Map.of(
                    "mosaikit.plugins.directory", PLUGINS.toString(), "mosaikit.ui.theme", "dev.mosaikit.test.green");
        }
    }

    @Test
    void offersTheThemesOfActiveThemePluginsBeforeSignIn() {
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
}
