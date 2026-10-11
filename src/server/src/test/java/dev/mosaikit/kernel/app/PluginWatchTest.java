// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.startsWith;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** A watched plugins directory is read again when it changes, without a restart (development mode). */
@QuarkusTest
@TestProfile(PluginWatchTest.Watched.class)
@Tag("MK-046")
class PluginWatchTest {

    static final Path PLUGINS = Path.of("target", "watch-test", "plugins").toAbsolutePath();

    /** An empty, watched plugins directory. */
    public static class Watched implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            try {
                Files.createDirectories(PLUGINS);
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
            return Map.of("mosaikit.plugins.directory", PLUGINS.toString(), "mosaikit.plugins.watch", "true");
        }
    }

    @Test
    void readsAChangedDirectoryAgainAndTellsTheShell() throws Exception {
        int before = revision();
        Path plugin = Files.createDirectories(PLUGINS.resolve("signs/web"));
        Files.writeString(plugin.resolve("index.js"), "export default { activate() {} };\n");
        Files.writeString(PLUGINS.resolve("signs/manifest.yaml"), """
                id: dev.mosaikit.test.signs
                version: 1.0.0
                name: Signs (test)
                kind: [app]
                platform: '>=0.1 <1'
                frontend:
                  entry: web/index.js
                """);

        Instant deadline = Instant.now().plus(Duration.ofSeconds(15));
        while (revision() == before && Instant.now().isBefore(deadline)) {
            Thread.sleep(200);
        }

        assertThat(revision()).isGreaterThan(before);
        asAdmin().get("/api/v1/shell/plugins").then().body("id", hasItem("dev.mosaikit.test.signs"));
        asAdmin()
                .get("/api/v1/plugin-assets/dev.mosaikit.test.signs/web/index.js")
                .then()
                .statusCode(200)
                .header("Cache-Control", startsWith("no-cache"));
    }

    private static int revision() {
        return asAdmin()
                .get("/api/v1/shell/plugins/revision")
                .then()
                .statusCode(200)
                .extract()
                .path("revision");
    }
}
