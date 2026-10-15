// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static java.nio.charset.StandardCharsets.UTF_8;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.not;

import dev.mosaikit.kernel.api.signature.ExtensionIndex;
import dev.mosaikit.kernel.api.signature.PackageSignatures;
import dev.mosaikit.kernel.api.signature.SigningKeys;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.ValidatableResponse;
import jakarta.inject.Inject;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Required and optional dependencies between extensions, respected by installation, update, removal
 * and turning off in an organization (MK-132). The extensions have only apps, so that each operation
 * takes effect at once, without a restart.
 */
@QuarkusTest
@TestProfile(ExtensionDependencyTest.Catalog.class)
@Tag("MK-132")
class ExtensionDependencyTest {

    static final Path ROOT = Path.of("target", "extension-dependency-test").toAbsolutePath();
    static final Path CATALOG = ROOT.resolve("catalog");
    static final Path EXTENSIONS = ROOT.resolve("extensions");
    static final KeyPair PUBLISHER = SigningKeys.generate();
    static final String BASE = "dev.mosaikit.test.base";
    static final String BOARD = "dev.mosaikit.test.board";
    static final String VIEWER = "dev.mosaikit.test.viewer";
    static final String STORE = "dev.mosaikit.test.store";
    static final String SHELF = "dev.mosaikit.test.shelf";
    static final String SLUG = "dependency-town";
    // ResourceReferencesTest: dashboards that refer to the maps of another extension (MK-135).
    static final String DASHBOARDS = "dev.mosaikit.test.dashboards";
    static final String MAPS = "dev.mosaikit.test.maps";

    /** Prepares the key and a signed catalog before the kernel starts. */
    public static class Catalog implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            try {
                prepare();
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
            return Map.of(
                    "mosaikit.extensions.directory", EXTENSIONS.toString(),
                    "mosaikit.extensions.trusted-keys-directory",
                            ROOT.resolve("trusted").toString(),
                    "mosaikit.marketplace.sources", CATALOG.toUri().toString());
        }
    }

    static void prepare() throws IOException {
        if (Files.exists(ROOT)) {
            try (Stream<Path> files = Files.walk(ROOT)) {
                files.sorted(Comparator.reverseOrder())
                        .forEach(path -> path.toFile().delete());
            }
        }
        Files.createDirectories(EXTENSIONS);
        SigningKeys.write(PUBLISHER, ROOT.resolve("trusted"), "publisher");
        Files.delete(ROOT.resolve("trusted/publisher.key.pem"));
        Files.createDirectories(CATALOG);
        pkg(BASE, "1.0.0", "base", "");
        pkg(BASE, "2.0.0", "base", "");
        pkg(BOARD, "1.0.0", "board", "requires: {" + BASE + ": '^1'}\n");
        pkg(BOARD, "2.0.0", "board", "requires: {" + BASE + ": '^2'}\n");
        // A schema to migrate: placed now, used at the next start.
        pkg(STORE, "1.0.0", "store", "database:\n  schema: ext_dependency_store\n");
        pkg(SHELF, "1.0.0", "shelf", "requires: {" + STORE + ": '^1'}\n");
        pkg(VIEWER, "1.0.0", "viewer", "optional: {" + BASE + ": '^1', dev.mosaikit.test.absent: '^1'}\n");
        pkg(DASHBOARDS, "1.0.0", "dashboards", resources("dashboard"));
        pkg(MAPS, "1.0.0", "maps", resources("map"));
        ExtensionIndex.write(CATALOG, PUBLISHER, Instant.now());
    }

    /** A resource type that people share to view, in the place of the dependencies of {@link #pkg}. */
    private static String resources(String type) {
        return "resources:\n  - { type: " + type + ", title: " + type + ", levels: [{ name: view, title: View }],"
                + " subjects: [person] }\n";
    }

    static Path pkg(String id, String version, String app, String dependencies) throws IOException {
        Path file = CATALOG.resolve(app + "-" + version + ".zip");
        try (var out = new ZipOutputStream(Files.newOutputStream(file))) {
            out.putNextEntry(new ZipEntry("manifest.yaml"));
            out.write(("id: " + id + "\nversion: " + version + "\nname: " + app + "\nkind: [app]\n"
                            + "platform: '>=0.1 <1'\n" + dependencies
                            + "contributes:\n  rail.app:\n    - { id: " + app + ", title: " + app
                            + ", route: /app/" + app + ", element: test-" + app + "-app }\n")
                    .getBytes(UTF_8));
            out.closeEntry();
        }
        PackageSignatures.sign(file, PUBLISHER);
        return file;
    }

    @Inject
    ExtensionRegistry registry;

    @AfterEach
    void uninstallEverything() throws IOException {
        try (Stream<Path> files = Files.list(EXTENSIONS)) {
            for (Path file :
                    files.filter(path -> path.toString().endsWith(".zip")).toList()) {
                Files.delete(file);
            }
        }
        registry.reload();
    }

    private static Map<String, String> item(String id, String version) {
        return Map.of("source", CATALOG.toUri().toString(), "id", id, "version", version);
    }

    private static ValidatableResponse install(String id, String version) {
        return asAdmin()
                .body(item(id, version))
                .post("/api/v1/marketplace/installations")
                .then();
    }

    @SafeVarargs
    private static ValidatableResponse installTogether(Map<String, String>... items) {
        return asAdmin()
                .body(Map.of("installations", List.of(items)))
                .post("/api/v1/marketplace/operations")
                .then();
    }

    private static void assertActive(String... ids) {
        for (String id : ids) {
            asAdmin().get("/api/v1/extensions").then().body("find { it.id == '" + id + "' }.status", equalTo("ACTIVE"));
        }
    }

    @Test
    void refusesToInstallAnExtensionWithoutWhatItRequiresAndInstallsThemTogether() throws IOException {
        install(BOARD, "1.0.0")
                .statusCode(409)
                .body(
                        "detail",
                        containsString(BOARD + " 1.0.0: Requires extension " + BASE + " ^1, which is not installed"));
        asAdmin()
                .contentType("application/zip")
                .body(Files.readAllBytes(CATALOG.resolve("board-1.0.0.zip")))
                .post("/api/v1/extensions/packages")
                .then()
                .statusCode(409)
                .body("detail", containsString("Requires extension " + BASE + " ^1, which is not installed"));

        install(BASE, "2.0.0").statusCode(202);
        install(BOARD, "1.0.0")
                .statusCode(409)
                .body("detail", containsString("Requires extension " + BASE + " ^1, found 2.0.0"));

        // An optional dependency missing or in another version never prevents installation.
        install(VIEWER, "1.0.0").statusCode(202).body("problems", empty());
        assertActive(VIEWER);

        installTogether(item(BOARD, "2.0.0"), item(BASE, "2.0.0"))
                .statusCode(202)
                .body("installations.id", equalTo(List.of(BOARD, BASE)));
        assertActive(BASE, BOARD, VIEWER);
        installTogether().statusCode(400);
    }

    @Test
    void refusesAnUpdateThatBreaksADependentUnlessItIsUpdatedToo() {
        installTogether(item(BASE, "1.0.0"), item(BOARD, "1.0.0"), item(VIEWER, "1.0.0"))
                .statusCode(202);
        assertActive(BASE, BOARD, VIEWER);

        install(BASE, "2.0.0")
                .statusCode(409)
                .body("detail", containsString("updating " + BASE + " from 1.0.0 to 2.0.0"))
                .body("detail", containsString(BOARD + " 1.0.0 (requires ^1)"))
                .body("detail", not(containsString(VIEWER)));
        assertActive(BASE);

        installTogether(item(BASE, "2.0.0"), item(BOARD, "2.0.0")).statusCode(202);
        asAdmin().get("/api/v1/extensions").then().body("find { it.id == '" + BASE + "' }.version", equalTo("2.0.0"));
        // The extension that uses it optionally, in a version it does not accept, stays active.
        assertActive(BASE, BOARD, VIEWER);
    }

    @Test
    void refusesToRemoveOrTurnOffAnExtensionThatAnotherRequires() {
        installTogether(item(BASE, "1.0.0"), item(BOARD, "1.0.0"), item(VIEWER, "1.0.0"))
                .statusCode(202);
        asAdmin().body(Map.of("slug", SLUG, "name", "Dependency Town")).post("/api/v1/organizations");

        Map<String, Object> baseOff = app(BASE, "base", false);
        asAdmin()
                .body(List.of(baseOff))
                .put("/api/v1/organizations/{slug}/apps", SLUG)
                .then()
                .statusCode(409)
                .body("detail", containsString(BASE + " is required by " + BOARD + " 1.0.0"))
                .body("detail", not(containsString(VIEWER)));
        asAdmin()
                .body(List.of(baseOff, app(BOARD, "board", false)))
                .put("/api/v1/organizations/{slug}/apps", SLUG)
                .then()
                .statusCode(200);
        asAdmin()
                .body(List.of())
                .put("/api/v1/organizations/{slug}/apps", SLUG)
                .then()
                .statusCode(200);

        asAdmin()
                .delete("/api/v1/extensions/{id}", BASE)
                .then()
                .statusCode(409)
                .body("detail", containsString(BASE + " is required by " + BOARD + " 1.0.0 (requires ^1)"))
                .body("detail", not(containsString(VIEWER)));
        assertActive(BASE, BOARD);
        asAdmin()
                .delete("/api/v1/extensions/{id}", BOARD)
                .then()
                .statusCode(200)
                .body("restartRequired", equalTo(false));
        asAdmin().delete("/api/v1/extensions/{id}", BASE).then().statusCode(200);
        asAdmin()
                .get("/api/v1/extensions")
                .then()
                .body("find { it.id == '" + BASE + "' }", equalTo(null))
                .body("find { it.id == '" + VIEWER + "' }.status", equalTo("ACTIVE"));
        asAdmin().delete("/api/v1/extensions/{id}", BASE).then().statusCode(404);
        asAdmin()
                .get("/api/v1/audit-events?limit=50")
                .then()
                .body(
                        "findAll { it.action == 'extension.removed' }.subject",
                        org.hamcrest.Matchers.hasItem(BASE + " 1.0.0"));
    }

    @Test
    void countsThePackagesThatWaitForARestart() {
        install(STORE, "1.0.0").statusCode(202).body("restartRequired", equalTo(true));
        // Placed but not started: it counts as installed for what requires it, and protects it.
        install(SHELF, "1.0.0").statusCode(202);
        asAdmin()
                .delete("/api/v1/extensions/{id}", STORE)
                .then()
                .statusCode(409)
                .body("detail", containsString(STORE + " is required by " + SHELF + " 1.0.0"));
        asAdmin().delete("/api/v1/extensions/{id}", SHELF).then().statusCode(200);
        asAdmin()
                .delete("/api/v1/extensions/{id}", STORE)
                .then()
                .statusCode(200)
                .body("restartRequired", equalTo(true));
    }

    private static Map<String, Object> app(String extensionId, String appId, boolean enabled) {
        return Map.of(
                "extensionId", extensionId, "appId", appId, "enabled", enabled, "pinned", false, "roles", List.of());
    }
}
