// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.nullValue;

import dev.mosaikit.kernel.api.signature.PackageSignatures;
import dev.mosaikit.kernel.api.signature.PluginIndex;
import dev.mosaikit.kernel.api.signature.SigningKeys;
import dev.mosaikit.kernel.core.plugin.PluginRegistry;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import jakarta.inject.Inject;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.time.Instant;
import java.util.Comparator;
import java.util.Map;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The marketplace (MK-022): two catalogs in local directories, as for an offline transfer; one
 * with a signed index, one whose package was changed after the index was signed.
 */
@QuarkusTest
@TestProfile(MarketplaceTest.Catalogs.class)
@Tag("MK-022")
class MarketplaceTest {

    static final Path ROOT = Path.of("target", "marketplace-test").toAbsolutePath();
    static final Path CATALOG = ROOT.resolve("catalog");
    static final Path TAMPERED = ROOT.resolve("tampered");
    static final Path PLUGINS = ROOT.resolve("plugins");
    static final KeyPair PUBLISHER = SigningKeys.generate();
    static final KeyPair STRANGER = SigningKeys.generate();
    static final String ID = "dev.mosaikit.test.market";

    /** Prepares the keys and the catalogs before the kernel starts. */
    public static class Catalogs implements QuarkusTestProfile {
        @Override
        public Map<String, String> getConfigOverrides() {
            try {
                prepare();
            } catch (IOException e) {
                throw new UncheckedIOException(e);
            }
            return Map.of(
                    "mosaikit.plugins.directory", PLUGINS.toString(),
                    "mosaikit.plugins.trusted-keys-directory",
                            ROOT.resolve("trusted").toString(),
                    "mosaikit.marketplace.sources",
                            CATALOG.toUri() + "," + TAMPERED.toUri() + ","
                                    + ROOT.resolve("missing").toUri());
        }
    }

    static void prepare() throws IOException {
        if (Files.exists(ROOT)) {
            try (Stream<Path> files = Files.walk(ROOT)) {
                files.sorted(Comparator.reverseOrder())
                        .forEach(path -> path.toFile().delete());
            }
        }
        Files.createDirectories(PLUGINS);
        SigningKeys.write(PUBLISHER, ROOT.resolve("trusted"), "publisher");
        Files.delete(ROOT.resolve("trusted/publisher.key.pem"));
        Files.createDirectories(CATALOG);
        PackageSignatures.sign(pkg(CATALOG.resolve("market-1.0.0.zip"), "1.0.0"), PUBLISHER);
        // 1.1.0 has a schema to migrate, so it takes effect at the next start; 1.0.0 at once.
        PackageSignatures.sign(
                pkg(CATALOG.resolve("market-1.1.0.zip"), "1.1.0", "A plugin of the marketplace test.", true),
                PUBLISHER);
        PluginIndex.write(CATALOG, PUBLISHER, Instant.now());
        Files.createDirectories(TAMPERED);
        Path changed = pkg(TAMPERED.resolve("market-2.0.0.zip"), "2.0.0");
        PackageSignatures.sign(changed, PUBLISHER);
        PluginIndex.write(TAMPERED, PUBLISHER, Instant.now());
        PackageSignatures.sign(pkg(changed, "2.0.0", "changed after the index"), PUBLISHER);
    }

    static Path pkg(Path file, String version) throws IOException {
        return pkg(file, version, "A plugin of the marketplace test.");
    }

    static Path pkg(Path file, String version, String description) throws IOException {
        return pkg(file, version, description, false);
    }

    static Path pkg(Path file, String version, String description, boolean schema) throws IOException {
        try (var out = new ZipOutputStream(Files.newOutputStream(file))) {
            out.putNextEntry(new ZipEntry("manifest.yaml"));
            out.write(("id: " + ID + "\nversion: " + version + "\nname: Market (test)\ndescription: " + description
                            + "\nkind: [service]\nplatform: '>=0.1 <1'\n"
                            + (schema ? "database:\n  schema: p_market\n" : ""))
                    .getBytes(UTF_8));
            out.closeEntry();
        }
        return file;
    }

    @Inject
    PluginRegistry registry;

    @Test
    void listsTheOffersOfVerifiedCatalogsOnly() {
        asAdmin()
                .get("/api/v1/marketplace")
                .then()
                .statusCode(200)
                .body("sources[0].status", equalTo("verified"))
                .body("sources[0].keyId", equalTo(SigningKeys.keyId(PUBLISHER.getPublic())))
                .body("sources[2].status", equalTo("refused"))
                .body("plugins.findAll { it.source == '" + CATALOG.toUri() + "' }.version", hasItem("1.1.0"))
                .body("plugins.find { it.version == '1.0.0' }.state", equalTo("available"));
        anonymous().get("/api/v1/marketplace").then().statusCode(401);
    }

    @Test
    void installsAPackageOfACatalogAndKeepsTheOneItReplaces() throws IOException {
        asAdmin()
                .body(Map.of("source", CATALOG.toUri().toString(), "id", ID, "version", "1.0.0"))
                .post("/api/v1/marketplace/installations")
                .then()
                .statusCode(202)
                .body("file", equalTo(ID + "-1.0.0.zip"))
                // Nothing to build or migrate: active at once (ADR-0031).
                .body("restartRequired", equalTo(false))
                .body("replaced", nullValue());
        assertThat(PLUGINS.resolve(ID + "-1.0.0.zip")).exists();
        asAdmin()
                .get("/api/v1/marketplace")
                .then()
                .body("plugins.find { it.version == '1.0.0' }.state", equalTo("installed"))
                .body("plugins.find { it.version == '1.1.0' }.state", equalTo("update"));

        // An update with a schema replaces the package and waits for the restart.
        asAdmin()
                .body(Map.of("source", CATALOG.toUri().toString(), "id", ID, "version", "1.1.0"))
                .post("/api/v1/marketplace/installations")
                .then()
                .statusCode(202)
                .body("restartRequired", equalTo(true))
                .body("replaced", equalTo(ID + "-1.0.0.zip"));
        assertThat(PLUGINS.resolve(ID + "-1.1.0.zip")).exists();
        // Until the restart the offer is waiting, so that nobody installs it twice.
        asAdmin()
                .get("/api/v1/marketplace")
                .then()
                .body("plugins.find { it.version == '1.1.0' }.state", equalTo("restart"));
        assertThat(PLUGINS.resolve(ID + "-1.0.0.zip")).doesNotExist();
        assertThat(PLUGINS.resolve(".previous").resolve(ID + "-1.0.0.zip")).exists();
        asAdmin()
                .get("/api/v1/audit-events?limit=50")
                .then()
                .body("findAll { it.action == 'plugin.installed' }.subject", hasItem(ID + " 1.1.0"));
        // The other tests find the catalog as at the start: nothing installed.
        Files.deleteIfExists(PLUGINS.resolve(ID + "-1.1.0.zip"));
        registry.reload();
    }

    @Test
    void refusesPackagesThatDoNotMatchTheSignedIndex() {
        asAdmin()
                .body(Map.of("source", TAMPERED.toUri().toString(), "id", ID, "version", "2.0.0"))
                .post("/api/v1/marketplace/installations")
                .then()
                .statusCode(403)
                .body("detail", containsString("does not match the signed index"));
        asAdmin()
                .body(Map.of("source", CATALOG.toUri().toString(), "id", ID, "version", "9.9.9"))
                .post("/api/v1/marketplace/installations")
                .then()
                .statusCode(404);
        asAdmin()
                .body(Map.of("source", "https://elsewhere.example/", "id", ID, "version", "1.0.0"))
                .post("/api/v1/marketplace/installations")
                .then()
                .statusCode(404);
    }

    @Test
    void installsOnlyUploadedPackagesOfTrustedPublishers() throws IOException {
        Path unsigned = pkg(ROOT.resolve("upload-unsigned.zip"), "3.0.0");
        Path stranger = pkg(ROOT.resolve("upload-stranger.zip"), "3.0.0");
        PackageSignatures.sign(stranger, STRANGER);
        Path trusted = pkg(ROOT.resolve("upload-trusted.zip"), "3.0.0");
        PackageSignatures.sign(trusted, PUBLISHER);

        upload(unsigned).then().statusCode(403).body("detail", containsString("not signed"));
        upload(stranger).then().statusCode(403).body("detail", containsString("is not trusted"));
        upload(trusted).then().statusCode(202).body("version", equalTo("3.0.0"));
        asAdmin()
                .contentType("application/zip")
                .body(new byte[0])
                .post("/api/v1/plugins/packages")
                .then()
                .statusCode(400);
        Files.delete(PLUGINS.resolve(ID + "-3.0.0.zip"));
        // Active at once when uploaded: the next tests find nothing installed.
        registry.reload();
    }

    private static io.restassured.response.Response upload(Path file) throws IOException {
        return asAdmin()
                .contentType("application/zip")
                .body(Files.readAllBytes(file))
                .post("/api/v1/plugins/packages");
    }
}
