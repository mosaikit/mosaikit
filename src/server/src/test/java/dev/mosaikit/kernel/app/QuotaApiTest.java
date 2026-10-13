// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.nullValue;

import io.quarkus.test.junit.QuarkusTest;
import io.quarkus.test.junit.TestProfile;
import io.restassured.RestAssured;
import io.restassured.config.EncoderConfig;
import io.restassured.path.json.JsonPath;
import io.restassured.specification.RequestSpecification;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The quotas of organizations for the Java code of extensions (MK-076), through a probe that calls
 * the {@code Quotas} bean as an extension does: a measure declared in the manifest gets a limit per
 * organization, an action is checked and counted against it and refused beyond it with a problem
 * detail naming the limit, the space of resources counts to storage with the files, and the
 * administrators see it by person.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-076")
class QuotaApiTest {

    static final String EXTENSION = "dev.mosaikit.test.quotas";
    static final String RENDERS = EXTENSION + "/renders";
    static final String PROBE = "/api/v1/test/quotas/";
    static final String PASSWORD = "a long enough password";

    private String acme;
    private String globex;
    private String boss;
    private String ada;
    private String cleo;

    @BeforeEach
    void people() {
        acme = organization();
        globex = organization();
        boss = register(acme);
        ada = register(acme);
        cleo = register(globex);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", acme, boss)
                .then()
                .statusCode(200);
    }

    // Helpers.

    private static String organization() {
        String slug = unique("quota-api");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("quota-api") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    private static String quotas(String organization) {
        return "/api/v1/organizations/" + organization + "/quotas";
    }

    private static void limit(String organization, String measure, long limit) {
        asAdmin()
                .body(Map.of("limit", limit))
                .put(quotas(organization) + "/" + measure)
                .then()
                .statusCode(200);
    }

    private static JsonPath call(RequestSpecification who, String action, String measure, long amount, int status) {
        return who.queryParam("amount", amount)
                .post(PROBE + action + "/" + EXTENSION + "/" + measure)
                .then()
                .log()
                .ifValidationFails()
                .statusCode(status)
                .extract()
                .jsonPath();
    }

    private static long used(String organization, String measure) {
        return asAdmin()
                .get(quotas(organization) + "/" + measure)
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getLong("used");
    }

    private void map(String person, String id) {
        in(person, acme)
                .contentType("application/json")
                .body(Map.of("title", "Map " + id, "link", "/app/maps/" + id))
                .put("/api/v1/test/resources/" + EXTENSION + "/map/" + id)
                .then()
                .statusCode(200);
    }

    // Acceptance 1.

    @Test
    void aMeasureDeclaredInTheManifestGetsALimitPerOrganization() {
        String month = YearMonth.now(ZoneOffset.UTC).toString();
        in(boss, acme)
                .get(quotas(acme) + "/" + RENDERS)
                .then()
                .statusCode(200)
                .body("label", equalTo("Renders"))
                .body("unit", equalTo("renders"))
                .body("kind", equalTo("counter"))
                .body("extension", equalTo(EXTENSION))
                .body("limit", nullValue())
                .body("period", equalTo(month));
        in(boss, acme).get(quotas(acme)).then().body("measure", hasItem(EXTENSION + "/layers"));

        limit(acme, RENDERS, 10);
        in(boss, acme)
                .get(quotas(acme) + "/" + RENDERS)
                .then()
                .body("limit", equalTo(10))
                .body("source", equalTo("organization"));
        // Another organization keeps its own limit: none.
        asAdmin().get(quotas(globex) + "/" + RENDERS).then().body("limit", nullValue());
    }

    // Acceptance 2.

    @Test
    void anActionThatWouldPassTheLimitIsRefusedWithAProblemNamingIt() {
        limit(acme, RENDERS, 10);

        JsonPath check = call(in(ada, acme), "check", "renders", 4, 200);
        assertThat(check.getBoolean("fits")).isTrue();
        assertThat(check.getLong("remaining")).isEqualTo(10);

        call(in(ada, acme), "consume", "renders", 4, 200);
        call(in(ada, acme), "consume", "renders", 5, 200);
        assertThat(call(in(ada, acme), "check", "renders", 2, 200).getBoolean("fits"))
                .isFalse();

        in(ada, acme)
                .queryParam("amount", 2)
                .post(PROBE + "consume/" + EXTENSION + "/renders")
                .then()
                .statusCode(403)
                .contentType("application/problem+json")
                .body("title", equalTo("Quota exceeded"))
                .body("detail", containsString("may use 10 renders of Renders (" + RENDERS + ")"))
                .body("detail", containsString("it used 9 renders"))
                .body("quota.measure", equalTo(RENDERS))
                .body("quota.limit", equalTo(10))
                .body("quota.used", equalTo(9))
                .body("quota.requested", equalTo(2))
                .body("quota.period", equalTo(YearMonth.now(ZoneOffset.UTC).toString()));
        assertThat(used(acme, RENDERS)).isEqualTo(9);
        call(in(ada, acme), "consume", "renders", 1, 200);

        // The other organization is not counted against this one.
        call(in(cleo, globex), "consume", "renders", 50, 200);
        assertThat(used(globex, RENDERS)).isEqualTo(50);
    }

    @Test
    void aGaugeOfAnExtensionIsSetAndAnIncreaseMustFit() {
        limit(acme, EXTENSION + "/layers", 5);
        call(in(ada, acme), "set", "layers", 4, 200);
        call(in(ada, acme), "set", "layers", 2, 200);
        assertThat(used(acme, EXTENSION + "/layers")).isEqualTo(2);
        in(ada, acme)
                .queryParam("amount", 6)
                .post(PROBE + "set/" + EXTENSION + "/layers")
                .then()
                .statusCode(403)
                .body("quota.requested", equalTo(4));
        call(in(ada, acme), "set", "layers", 5, 200);
        assertThat(used(acme, EXTENSION + "/layers")).isEqualTo(5);
    }

    @Test
    void consumptionAtTheSameTimeCannotPassTheLimit() throws Exception {
        limit(acme, RENDERS, 10);
        int calls = 8;
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(calls);
        try {
            List<Future<Integer>> answers = new ArrayList<>();
            for (int i = 0; i < calls; i++) {
                Callable<Integer> call = () -> {
                    start.await();
                    return in(ada, acme)
                            .queryParam("amount", 3)
                            .post(PROBE + "consume/" + EXTENSION + "/renders")
                            .statusCode();
                };
                answers.add(pool.submit(call));
            }
            start.countDown();
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> answer : answers) {
                statuses.add(answer.get());
            }
            assertThat(statuses).filteredOn(status -> status == 200).hasSize(3);
            assertThat(statuses).filteredOn(status -> status == 403).hasSize(calls - 3);
        } finally {
            pool.shutdownNow();
        }
        assertThat(used(acme, RENDERS)).isEqualTo(9);
    }

    @Test
    void onlyDeclaredMeasuresOfActiveExtensionsAreCounted() {
        call(in(ada, acme), "consume", "credits", 1, 400);
        call(in(ada, acme), "consume", "layers", 1, 400);
        call(in(ada, acme), "set", "renders", 1, 400);
        call(in(ada, acme), "consume", "storage", 1, 400);
        assertThat(call(in(ada, acme), "check", "storage", 1, 200).getString("unit"))
                .isEqualTo("bytes");
        in(ada, acme)
                .queryParam("amount", 1)
                .post(PROBE + "consume/dev.mosaikit.test.none/renders")
                .then()
                .statusCode(400);
    }

    // Acceptance 3.

    @Test
    void theSpaceOfResourcesCountsToStorageWithTheFiles() {
        limit(acme, "storage", 1000);
        map(ada, "rome");
        map(ada, "milan");

        in(ada, acme)
                .queryParam("bytes", 600)
                .put(PROBE + "space/" + EXTENSION + "/map/rome")
                .then()
                .statusCode(204);
        assertThat(used(acme, "storage")).isEqualTo(600);

        // A file that does not fit with the space of the maps is refused, and so is more space.
        in(ada, acme)
                .config(RestAssured.config()
                        .encoderConfig(EncoderConfig.encoderConfig()
                                .appendDefaultContentCharsetToContentTypeIfUndefined(false)))
                .contentType("application/octet-stream")
                .body(new byte[500])
                .post("/api/v1/files/" + FileStorageTest.EXTENSION + "?name=big.bin")
                .then()
                .statusCode(403)
                .body("quota.measure", equalTo("storage"));
        in(ada, acme)
                .queryParam("bytes", 500)
                .put(PROBE + "space/" + EXTENSION + "/map/milan")
                .then()
                .statusCode(403)
                .body("title", equalTo("Quota exceeded"))
                .body("quota.limit", equalTo(1000))
                .body("quota.used", equalTo(600))
                .body("quota.requested", equalTo(500));
        assertThat(call(in(ada, acme), "check", "storage", 500, 200).getBoolean("fits"))
                .isFalse();

        // Less space always passes; a resource that goes takes its space with it.
        in(ada, acme)
                .queryParam("bytes", 100)
                .put(PROBE + "space/" + EXTENSION + "/map/rome")
                .then()
                .statusCode(204);
        assertThat(used(acme, "storage")).isEqualTo(100);
        in(ada, acme)
                .queryParam("bytes", 500)
                .put(PROBE + "space/" + EXTENSION + "/map/milan")
                .then()
                .statusCode(204);
        assertThat(used(acme, "storage")).isEqualTo(600);
        in(ada, acme)
                .delete("/api/v1/test/resources/" + EXTENSION + "/map/milan")
                .then()
                .statusCode(204);
        assertThat(used(acme, "storage")).isEqualTo(100);

        // Only registered resources of the extension.
        in(ada, acme)
                .queryParam("bytes", 1)
                .put(PROBE + "space/" + EXTENSION + "/map/paris")
                .then()
                .statusCode(400);
    }

    // Acceptance 4, for the measures of extensions.

    @Test
    void theAdministratorsSeeTheConsumptionOfExtensionsByPerson() {
        String adaId = in(ada, acme).get("/api/v1/accounts/me").path("id");
        call(in(ada, acme), "consume", "renders", 7, 200);
        call(in(boss, acme), "consume", "renders", 2, 200);
        map(ada, "turin");
        in(ada, acme)
                .queryParam("bytes", 300)
                .put(PROBE + "space/" + EXTENSION + "/map/turin")
                .then()
                .statusCode(204);

        String month = YearMonth.now(ZoneOffset.UTC).toString();
        in(boss, acme)
                .get(quotas(acme) + "/usage")
                .then()
                .statusCode(200)
                .body("periods", hasItem(month))
                .body("rows.findAll { it.measure == '" + RENDERS + "' }.amount", equalTo(List.of(7, 2)))
                .body("rows.find { it.measure == '" + RENDERS + "' }.person.id", equalTo(adaId))
                .body("rows.find { it.measure == '" + RENDERS + "' }.period", equalTo(month))
                .body("rows.find { it.measure == 'storage' }.person.id", equalTo(adaId))
                .body("rows.find { it.measure == 'storage' }.amount", equalTo(300));
        in(boss, acme)
                .queryParam("period", "2020-01")
                .get(quotas(acme) + "/usage")
                .then()
                .body("rows.measure", org.hamcrest.Matchers.not(hasItem(RENDERS)));
    }
}
