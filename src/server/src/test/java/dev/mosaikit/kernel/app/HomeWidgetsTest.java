// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static java.nio.charset.StandardCharsets.UTF_8;
import static org.hamcrest.Matchers.containsInAnyOrder;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;

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
 * The home page of widgets contributed by extensions (MK-101): a widget declares the roles it appears
 * for, and whether anonymous visitors see it, in the typed point {@code home.widget} of the kernel. On
 * the same installation a platform administrator, an organization administrator, a member and a
 * visitor each receive their own set.
 */
@QuarkusTest
@TestProfile(HomeWidgetsTest.Catalog.class)
@Tag("MK-101")
class HomeWidgetsTest {

    static final Path ROOT = Path.of("target", "home-widgets-test").toAbsolutePath();
    static final Path CATALOG_DIRECTORY = ROOT.resolve("catalog");
    static final Path EXTENSIONS = ROOT.resolve("extensions");
    static final KeyPair PUBLISHER = SigningKeys.generate();
    static final String HOME = "dev.mosaikit.test.home";
    static final String BROKEN = "dev.mosaikit.test.broken-home";
    static final String PRIVATE = "dev.mosaikit.test.private-home";
    static final String PASSWORD = "a long enough password";

    /** One widget for each audience: visitors and everyone, everyone signed in, and each role. */
    static final String WIDGETS = """
            contributes:
              home.widget:
                - { id: news, title: News, element: test-news-widget, public: true, size: wide, order: 1 }
                - { id: shortcuts, title: Shortcuts, element: test-shortcuts-widget }
                - { id: health, title: Health, element: test-health-widget, roles: [platform-admin] }
                - { id: requests, title: Requests, element: test-requests-widget, roles: [organization-admin] }
                - id: tasks
                  title: Tasks
                  element: test-tasks-widget
                  roles: [organization-user]
                  i18n: { it: { title: Compiti } }
            """;

    /** A widget for a role the kernel does not know, without a title. */
    static final String BROKEN_WIDGETS = """
            contributes:
              home.widget:
                - { id: odd, element: test-odd-widget, roles: [owner] }
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
        pkg(HOME, "home", WIDGETS);
        pkg(BROKEN, "broken", BROKEN_WIDGETS);
        pkg(PRIVATE, "private", """
                contributes:
                  home.widget:
                    - { id: inside, title: Inside, element: test-inside-widget, public: false }
                """);
        ExtensionIndex.write(CATALOG_DIRECTORY, PUBLISHER, Instant.now());
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
        String withApp = extra.replace(
                "contributes:\n",
                "contributes:\n  rail.app:\n    - { id: " + app + ", title: " + app + ", route: /app/" + app
                        + ", element: test-" + app + "-app }\n");
        return "id: " + id + "\nversion: 1.0.0\nname: " + app + "\nkind: [app]\nplatform: '>=0.1 <1'\n"
                + "frontend:\n  entry: web/index.js\n" + withApp;
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

    /** A new organization: its administrator and a member. */
    private static List<RequestSpecification> organization() {
        String slug = unique("home");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        String administrator = register(slug);
        String member = register(slug);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", slug, administrator)
                .then()
                .statusCode(200);
        return List.of(
                as(administrator, PASSWORD).header("X-Mosaikit-Organization", slug),
                as(member, PASSWORD).header("X-Mosaikit-Organization", slug));
    }

    private static String register(String slug) {
        String email = unique("home") + "@example.org";
        anonymous()
                .body(Map.of("organization", slug, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static ValidatableResponse shell(RequestSpecification who) {
        return who.get("/api/v1/shell/extensions").then().statusCode(200);
    }

    /** The identifiers of the widgets of the extension that the shell receives. */
    private static final String HOME_WIDGETS =
            "find { it.id == '" + HOME + "' }.contributions.findAll { it.point == 'home.widget' }.id";

    @Test
    void aPlatformAdministratorAnOrganizationAdministratorAndAMemberSeeDifferentWidgets() {
        install(HOME).statusCode(202).body("problems", empty());
        List<RequestSpecification> people = organization();

        shell(asAdmin()).body(HOME_WIDGETS, containsInAnyOrder("news", "shortcuts", "health"));
        shell(people.get(0)).body(HOME_WIDGETS, containsInAnyOrder("news", "shortcuts", "requests", "tasks"));
        shell(people.get(1)).body(HOME_WIDGETS, containsInAnyOrder("news", "shortcuts", "tasks"));
        // The rest of the extension is the same for everybody.
        shell(people.get(1)).body("find { it.id == '" + HOME + "' }.contributions.point", hasItem("rail.app"));

        // And a visitor of the same installation sees only the public one.
        anonymous()
                .get("/api/v1/shell/home/public")
                .then()
                .statusCode(200)
                .body("find { it.id == '" + HOME + "' }.contributions.id", equalTo(List.of("news")));
    }

    @Test
    void anAnonymousVisitorSeesOnlyThePublicWidgets() {
        install(HOME).statusCode(202);
        install(PRIVATE).statusCode(202);

        anonymous()
                .get("/api/v1/shell/home/public")
                .then()
                .statusCode(200)
                // Only the extensions with a public widget, with only those widgets.
                .body("id", equalTo(List.of(HOME)))
                .body("[0].contributions.id", equalTo(List.of("news")))
                .body("[0].contributions[0].attributes.size", equalTo("wide"))
                .body("[0].points", empty())
                .body("[0].bridge.api", nullValue());
        // The extensions themselves stay closed to visitors.
        anonymous().get("/api/v1/shell/extensions").then().statusCode(401);
    }

    @Test
    void refusesAWidgetThatDoesNotDeclareWhoItIsForCorrectly() {
        install(BROKEN)
                .statusCode(409)
                .body(
                        "detail",
                        containsString("the contribution odd of " + BROKEN + " 1.0.0 to home.widget does not match"
                                + " the schema of the kernel: "))
                .body("detail", containsString("odd.roles"))
                .body("detail", containsString("title"));
    }

    @Test
    void neverServesAWidgetThatDoesNotMatchThePointOfTheKernel() throws IOException {
        // Copied into the directory, so not checked by the marketplace.
        Path web = Files.createDirectories(EXTENSIONS.resolve("broken").resolve("web"));
        Files.writeString(web.resolve("index.js"), "export default { activate() {} };\n");
        Files.writeString(web.getParent().resolve("manifest.yaml"), manifest(BROKEN, "broken", BROKEN_WIDGETS));
        registry.reload();

        shell(asAdmin())
                .body("find { it.id == '" + BROKEN + "' }.contributions.point", not(hasItem("home.widget")))
                .body("find { it.id == '" + BROKEN + "' }.contributions.id", hasItem("broken"));
        anonymous().get("/api/v1/shell/home/public").then().statusCode(200).body("id", not(hasItem(BROKEN)));
    }
}
