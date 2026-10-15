// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.ContractsProbe.CARDS;
import static dev.mosaikit.kernel.app.ContractsProbe.CATALOG;
import static dev.mosaikit.kernel.app.ContractsProbe.FILES;
import static dev.mosaikit.kernel.app.ContractsProbe.WEB;
import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static java.nio.charset.StandardCharsets.UTF_8;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;

import dev.mosaikit.kernel.api.signature.ExtensionIndex;
import dev.mosaikit.kernel.api.signature.PackageSignatures;
import dev.mosaikit.kernel.api.signature.SigningKeys;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.QuarkusTestProfile;
import io.quarkus.test.junit.TestProfile;
import io.restassured.response.ValidatableResponse;
import io.restassured.specification.RequestSpecification;
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
 * Versioned contracts between extensions (MK-134). On the server, a catalog finds the connectors of
 * the organization through its contract: a connector installed, turned off or removed is found, or no
 * longer found, without a change to the catalog. In the frontend, a point declares the JSON Schema of
 * the payload of each of its versions: a contribution that does not match is refused at installation
 * with the reason, and never reaches the owner. The extensions have only apps, so that each operation
 * takes effect at once, without a restart; {@link ContractsProbe} stands for their Java code.
 */
@QuarkusTest
@TestProfile(ExtensionContractsTest.Catalog.class)
@Tag("MK-134")
class ExtensionContractsTest {

    static final Path ROOT = Path.of("target", "extension-contracts-test").toAbsolutePath();
    static final Path CATALOG_DIRECTORY = ROOT.resolve("catalog");
    static final Path EXTENSIONS = ROOT.resolve("extensions");
    static final KeyPair PUBLISHER = SigningKeys.generate();
    static final String LEGACY = "dev.mosaikit.test.legacy-connector";
    static final String BROKEN_CARDS = "dev.mosaikit.test.broken-cards";
    static final String PASSWORD = "a long enough password";

    /**
     * The catalog: it provides the contract "connector" in version 1, and its point "catalog.card" in
     * version 1, untyped, and in version 2 with an element and a size, nothing else.
     */
    static final String CATALOG_MANIFEST = """
            contracts:
              provides: [{ name: connector, versions: [1] }]
            frontend:
              entry: web/index.js
              points:
                - catalog.card
                - name: catalog.card
                  version: 2
                  schema:
                    type: object
                    required: [element, size]
                    additionalProperties: false
                    properties:
                      element: { type: string, minLength: 1 }
                      size: { type: string, enum: [small, large] }
                      title: { type: string }
            """;

    /** Prepares the key and a signed catalog of packages before the kernel starts. */
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
                    "mosaikit.marketplace.sources", CATALOG_DIRECTORY.toUri().toString());
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
        Files.createDirectories(CATALOG_DIRECTORY);
        pkg(CATALOG, "catalog", CATALOG_MANIFEST);
        pkg(FILES, "files", connector(1));
        pkg(WEB, "web", connector(1));
        pkg(LEGACY, "legacy", connector(2));
        pkg(CARDS, "cards", cards("large"));
        pkg(BROKEN_CARDS, "broken", cards("huge"));
        ExtensionIndex.write(CATALOG_DIRECTORY, PUBLISHER, Instant.now());
    }

    static String connector(int version) {
        return """
                contracts:
                  implements: [{ contract: %s/connector, version: %d }]
                """.formatted(CATALOG, version);
    }

    /** Cards for the catalog, in both versions of its point. */
    static String cards(String size) {
        return """
                contributes:
                  catalog.card:
                    - { id: plain, element: plain-card, anything: [1, 2] }
                  catalog.card@2:
                    - { id: sized, element: sized-card, size: %s, i18n: { it: { title: Scheda } } }
                """.formatted(size);
    }

    static void pkg(String id, String app, String extra) throws IOException {
        Path file = CATALOG_DIRECTORY.resolve(app + "-1.0.0.zip");
        try (var out = new ZipOutputStream(Files.newOutputStream(file))) {
            out.putNextEntry(new ZipEntry("manifest.yaml"));
            out.write(manifest(id, app, extra).getBytes(UTF_8));
            out.closeEntry();
            out.putNextEntry(new ZipEntry("web/index.js"));
            out.write("export default { activate() {} };\n".getBytes(UTF_8));
            out.closeEntry();
        }
        PackageSignatures.sign(file, PUBLISHER);
    }

    static String manifest(String id, String app, String extra) {
        String withApp = extra.contains("contributes:")
                ? extra.replace("contributes:\n", "contributes:\n" + rail(app))
                : extra + "contributes:\n" + rail(app);
        String frontend = withApp.contains("frontend:") ? "" : "frontend:\n  entry: web/index.js\n";
        return "id: " + id + "\nversion: 1.0.0\nname: " + app + "\nkind: [app]\nplatform: '>=0.1 <1'\n" + frontend
                + withApp;
    }

    private static String rail(String app) {
        return "  rail.app:\n    - { id: " + app + ", title: " + app + ", route: /app/" + app + ", element: test-" + app
                + "-app }\n";
    }

    @Inject
    ExtensionRegistry registry;

    @AfterEach
    void uninstallEverything() throws IOException {
        try (Stream<Path> files = Files.walk(EXTENSIONS)) {
            for (Path file : files.sorted(Comparator.reverseOrder())
                    .filter(path -> !path.equals(EXTENSIONS))
                    .toList()) {
                Files.delete(file);
            }
        }
        registry.reload();
    }

    private static ValidatableResponse install(String id) {
        return asAdmin()
                .body(Map.of("source", CATALOG_DIRECTORY.toUri().toString(), "id", id, "version", "1.0.0"))
                .post("/api/v1/marketplace/installations")
                .then();
    }

    /** A person of an organization, who makes the requests of the catalog. */
    record Person(String email, String organization) {

        RequestSpecification request() {
            return as(email, PASSWORD).header("X-Mosaikit-Organization", organization);
        }
    }

    /** A new organization with a person in it. */
    private static Person person() {
        String organization = unique("contracts");
        asAdmin()
                .body(Map.of("slug", organization, "name", organization, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        String email = unique("contracts") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return new Person(email, organization);
    }

    private static void turn(Person person, String extensionId, String app, boolean enabled) {
        asAdmin()
                .body(List.of(Map.of(
                        "extensionId",
                        extensionId,
                        "appId",
                        app,
                        "enabled",
                        enabled,
                        "pinned",
                        false,
                        "roles",
                        List.of())))
                .put("/api/v1/organizations/{slug}/apps", person.organization())
                .then()
                .statusCode(200);
    }

    private static ValidatableResponse items(Person person) {
        return person.request().get("/api/v1/test/contracts/items").then().statusCode(200);
    }

    @Test
    void theCatalogFindsTheConnectorsOfTheOrganizationWithoutAChange() {
        install(CATALOG).statusCode(202).body("problems", empty());
        Person person = person();
        Person other = person();
        items(person).body("$", empty());

        install(FILES).statusCode(202).body("problems", empty());
        items(person).body("$", equalTo(List.of("files:main")));

        // Installed: found at once, by every organization.
        install(WEB).statusCode(202);
        items(person).body("$", equalTo(List.of("files:main", "web:main")));
        items(other).body("$", equalTo(List.of("files:main", "web:main")));

        // Turned off by one organization: no longer found there, still found by the other.
        turn(person, WEB, "web", false);
        items(person).body("$", equalTo(List.of("files:main")));
        items(other).body("$", equalTo(List.of("files:main", "web:main")));
        turn(person, WEB, "web", true);
        items(person).body("$", equalTo(List.of("files:main", "web:main")));

        // Removed: no longer found.
        asAdmin().delete("/api/v1/extensions/{id}", FILES).then().statusCode(200);
        items(person).body("$", equalTo(List.of("web:main")));

        // An extension with an implementation its manifest does not declare is not a connector.
        install(CARDS).statusCode(202);
        items(person).body("$", not(hasItem("undeclared:main")));
        person.request()
                .get("/api/v1/test/contracts/not-a-contract")
                .then()
                .statusCode(200)
                .body(containsString("is not a contract: mark the interface with @Contract"));
    }

    @Test
    void refusesAConnectorOfAVersionThatTheCatalogDoesNotServe() {
        install(CATALOG).statusCode(202);

        install(LEGACY)
                .statusCode(409)
                .body(
                        "detail",
                        containsString(LEGACY + " 1.0.0 implements " + CATALOG + "/connector version 2, which "
                                + CATALOG + " 1.0.0 does not serve (it serves version 1)"));
    }

    @Test
    void refusesACardThatDoesNotMatchTheSchemaOfItsPointWithTheReason() {
        install(CATALOG).statusCode(202);

        install(BROKEN_CARDS)
                .statusCode(409)
                .body(
                        "detail",
                        containsString("the contribution sized of " + BROKEN_CARDS + " 1.0.0 to catalog.card@2 does"
                                + " not match the schema of " + CATALOG + " 1.0.0: sized.size must be one of [small,"
                                + " large]"));
        install(CARDS).statusCode(202).body("problems", empty());

        // The owner receives the contributions to both versions of its point.
        person().request()
                .get("/api/v1/shell/extensions")
                .then()
                .statusCode(200)
                .body("find { it.id == '" + CATALOG + "' }.points", equalTo(List.of("catalog.card", "catalog.card@2")))
                .body("find { it.id == '" + CARDS + "' }.contributions.point", hasItem("catalog.card@2"))
                .body("find { it.id == '" + CARDS + "' }.contributions.point", hasItem("catalog.card"));
    }

    @Test
    void neverGivesTheOwnerAContributionThatDoesNotMatchItsPoint() throws IOException {
        // Copied into the directory, so not checked by the marketplace.
        copy(BROKEN_CARDS, "broken", cards("huge"));
        copy(CATALOG, "catalog", CATALOG_MANIFEST);
        registry.reload();

        person().request()
                .get("/api/v1/shell/extensions")
                .then()
                .statusCode(200)
                .body("find { it.id == '" + BROKEN_CARDS + "' }.contributions.id", hasItem("plain"))
                .body("find { it.id == '" + BROKEN_CARDS + "' }.contributions.id", not(hasItem("sized")));
    }

    private static void copy(String id, String app, String extra) throws IOException {
        Path web = Files.createDirectories(EXTENSIONS.resolve(app).resolve("web"));
        Files.writeString(web.resolve("index.js"), "export default { activate() {} };\n");
        Files.writeString(web.getParent().resolve("manifest.yaml"), manifest(id, app, extra));
    }
}
