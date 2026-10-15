// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.empty;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.nullValue;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ExtensionManifests;
import dev.mosaikit.kernel.api.extension.ManifestParseResult;
import dev.mosaikit.kernel.core.ai.ExtensionResponse;
import dev.mosaikit.kernel.core.search.SearchProviders;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The global search through the REST API (MK-040): the people and the teams of the organization with
 * PostgreSQL full-text search, the providers of extensions through a fake of their backends, the
 * results a person may not read, and a provider slower than the time limit of the tests (1 s).
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-040")
class SearchTest {

    private static final String PASSWORD = "a long enough password";
    private static final String FINDER = "dev.mosaikit.test.finder";
    private static final String RESOURCES = "dev.mosaikit.test.resources";
    private static final String FINDER_PATH = "/api/v1/ext/finder/search";
    private static final String SLOW_PATH = "/api/v1/ext/slow/search";

    @Inject
    FakeActionInvoker backends;

    private String acme;
    private String globex;
    private String ada;
    private String bea;
    private String cleo;
    private String surname;

    @BeforeEach
    void people() {
        backends.reset();
        acme = organization();
        globex = organization();
        // A surname of its own, so that other tests never match.
        surname = "Zq" + unique("s").replaceAll("[^a-z0-9]", "");
        ada = register(acme, "Ada " + surname);
        bea = register(acme, "Bea " + surname);
        cleo = register(globex, "Cleo " + surname);
    }

    private static String organization() {
        String slug = unique("search");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization, String name) {
        String email = unique("search") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", name, "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    private static ExtensionManifest provider(String id, String api) {
        Map<String, Object> tree = Map.of(
                "id",
                id,
                "version",
                "1.0.0",
                "name",
                id,
                "kind",
                List.of("app"),
                "platform",
                ">=0.1 <1",
                "backend",
                Map.of("jar", "lib/x.jar", "api", api),
                "contributes",
                Map.of(SearchProviders.POINT, List.of(Map.of("id", "items", "title", "Items", "path", "search"))));
        return ((ManifestParseResult.Valid) ExtensionManifests.parse(tree)).manifest();
    }

    private void withProviders(ExtensionManifest... manifests) {
        QuarkusMock.installMockForType(new SearchProviders(() -> List.of(manifests)), SearchProviders.class);
    }

    @Test
    void listsThePillsOfTheKernelAndOfTheExtensions() {
        in(ada, acme)
                .get("/api/v1/search/providers")
                .then()
                .statusCode(200)
                .body("id[0]", equalTo("people"))
                .body("id[1]", equalTo("teams"))
                .body("[0].extension", nullValue());
        withProviders(provider(FINDER, "finder"));
        in(ada, acme)
                .get("/api/v1/search/providers")
                .then()
                .statusCode(200)
                .body("id", contains("people", "teams", FINDER + "/items"))
                .body("[2].title", equalTo("Items"))
                .body("[2].extension", equalTo(FINDER));
    }

    @Test
    void findsThePeopleOfTheOrganizationOnly() {
        in(ada, acme)
                .queryParam("q", surname.substring(0, 6))
                .get("/api/v1/search")
                .then()
                .statusCode(200)
                .body(
                        "sections.find { it.provider == 'people' }.results.title",
                        contains("Ada " + surname, "Bea " + surname))
                .body("sections.find { it.provider == 'people' }.status", equalTo("complete"));
        // By a word of the email address, in a pill, with paging.
        in(ada, acme)
                .queryParam("q", bea.substring(0, bea.indexOf('@')))
                .queryParam("provider", "people")
                .get("/api/v1/search")
                .then()
                .statusCode(200)
                .body("sections", hasSize(1))
                .body("sections[0].results.detail", contains(bea));
        in(ada, acme)
                .queryParam("q", "bea " + surname)
                .queryParam("provider", "people")
                .queryParam("limit", 1)
                .get("/api/v1/search")
                .then()
                .statusCode(200)
                .body("sections[0].results.title", contains("Bea " + surname))
                .body("sections[0].more", equalTo(false));
        in(ada, acme)
                .queryParam("q", surname)
                .queryParam("provider", "people")
                .queryParam("offset", 1)
                .queryParam("limit", 1)
                .get("/api/v1/search")
                .then()
                .statusCode(200)
                .body("sections[0].results.title", contains("Bea " + surname))
                .body("sections[0].more", equalTo(false));
        // Cleo is in another organization: never found from this one, and the other way round.
        in(cleo, globex)
                .queryParam("q", surname)
                .queryParam("provider", "people")
                .get("/api/v1/search")
                .then()
                .statusCode(200)
                .body("sections[0].results.title", contains("Cleo " + surname));
    }

    @Test
    void findsTheTeamsThePersonSeesOnly() {
        String open = "Open " + surname;
        String closed = "Closed " + surname;
        for (String[] team : new String[][] {{open, "public"}, {closed, "private"}}) {
            in(ada, acme)
                    .body(Map.of("name", team[0], "description", "Roads and bridges", "visibility", team[1]))
                    .post("/api/v1/teams")
                    .then()
                    .statusCode(201);
        }
        in(ada, acme)
                .queryParam("q", surname)
                .queryParam("provider", "teams")
                .get("/api/v1/search")
                .then()
                .statusCode(200)
                .body("sections[0].results.title", contains(closed, open))
                .body("sections[0].results.detail", contains("Roads and bridges", "Roads and bridges"));
        // Bea is not in the private team.
        in(bea, acme)
                .queryParam("q", surname + " bridg")
                .queryParam("provider", "teams")
                .get("/api/v1/search")
                .then()
                .statusCode(200)
                .body("sections[0].results.title", contains(open));
        in(cleo, globex)
                .queryParam("q", surname)
                .queryParam("provider", "teams")
                .get("/api/v1/search")
                .then()
                .statusCode(200)
                .body("sections[0].results", empty());
    }

    @Test
    void aResultOfAnExtensionIsShownOnlyToWhoMayReadItsResource() {
        String note = unique("n");
        in(ada, acme)
                .body(Map.of("title", "Plans of " + surname, "link", "/app/notes/" + note))
                .put("/api/v1/test/resources/" + RESOURCES + "/note/" + note)
                .then()
                .statusCode(200);
        withProviders(provider(FINDER, "finder"));
        backends.answer(
                FINDER_PATH,
                new ExtensionResponse(
                        200,
                        Map.of(
                                "results",
                                List.of(
                                        Map.of("resource", Map.of("extension", RESOURCES, "type", "note", "id", note)),
                                        Map.of(
                                                "title",
                                                "Of an absent extension",
                                                "resource",
                                                Map.of("extension", "org.example.absent", "type", "note", "id", "x")),
                                        Map.of("title", "Plain", "link", "https://example.org/")),
                                "more",
                                false)));

        in(ada, acme)
                .queryParam("q", "plans")
                .get("/api/v1/search")
                .then()
                .statusCode(200)
                .body(
                        "sections.find { it.provider == '" + FINDER + "/items' }.results.title",
                        contains("Plans of " + surname, "Plain"))
                .body(
                        "sections.find { it.provider == '" + FINDER + "/items' }.results[0].link",
                        equalTo("/app/notes/" + note))
                .body("sections.find { it.provider == '" + FINDER + "/items' }.results[1].link", nullValue());
        // Bea has no level on the note of Ada.
        in(bea, acme)
                .queryParam("q", "plans")
                .queryParam("provider", FINDER + "/items")
                .get("/api/v1/search")
                .then()
                .statusCode(200)
                .body("sections[0].results.title", contains("Plain"));

        // The extension got the text, as a tsquery too, with the credentials of the person.
        assertThat(backends.sent()).isNotEmpty().allSatisfy(sent -> {
            assertThat(sent.call().target()).startsWith(FINDER_PATH + "?q=plans&tsquery=plans%3A*&offset=0&limit=");
            assertThat(sent.caller().organizationSlug()).isEqualTo(acme);
        });
    }

    @Test
    void aSlowProviderIsShownAsIncompleteAndTheOthersAreShownAnyway() {
        withProviders(provider(FINDER, "finder"), provider("dev.mosaikit.test.slow", "slow"));
        backends.answer(
                FINDER_PATH,
                new ExtensionResponse(200, Map.of("results", List.of(Map.of("title", "Quick " + surname)))));
        backends.delay(SLOW_PATH, Duration.ofSeconds(4));

        long started = System.nanoTime();
        in(ada, acme)
                .queryParam("q", surname)
                .get("/api/v1/search")
                .then()
                .statusCode(200)
                .body(
                        "sections.provider",
                        contains("people", "teams", FINDER + "/items", "dev.mosaikit.test.slow/items"))
                .body("sections[1].status", equalTo("complete"))
                .body("sections[0].results.title", contains("Ada " + surname, "Bea " + surname))
                .body("sections[2].status", equalTo("complete"))
                .body("sections[2].results.title", contains("Quick " + surname))
                .body("sections[3].status", equalTo("incomplete"))
                .body("sections[3].reason", equalTo("timeout"))
                .body("sections[3].results", empty());
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(4));
    }

    @Test
    void refusesASearchWithoutTextOrWithAnUnknownProvider() {
        in(ada, acme).get("/api/v1/search").then().statusCode(400);
        in(ada, acme).queryParam("q", "  ").get("/api/v1/search").then().statusCode(400);
        in(ada, acme)
                .queryParam("q", "ada")
                .queryParam("provider", "org.example.absent/items")
                .get("/api/v1/search")
                .then()
                .statusCode(404);
        in(ada, acme)
                .queryParam("q", "ada")
                .queryParam("provider", "people")
                .queryParam("limit", 500)
                .get("/api/v1/search")
                .then()
                .statusCode(400);
        anonymous().queryParam("q", "ada").get("/api/v1/search").then().statusCode(401);
    }
}
