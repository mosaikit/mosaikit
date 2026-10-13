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
import io.restassured.response.Response;
import io.restassured.specification.RequestSpecification;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
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
 * The storage quota of organizations through the REST API (MK-076): platform administrators set a
 * limit per organization, the file service refuses what does not fit with a problem detail naming
 * the limit, even for uploads at the same time, and the administrators of the organization see what
 * it keeps, by person.
 */
@QuarkusTest
@TestProfile(TestExtensions.class)
@Tag("MK-076")
class QuotaTest {

    static final String FILES = "/api/v1/files/" + FileStorageTest.EXTENSION;
    static final String PASSWORD = "a long enough password";

    private String acme;
    private String globex;
    private String boss;
    private String ada;
    private String globexBoss;

    @BeforeEach
    void people() {
        acme = organization();
        globex = organization();
        boss = register(acme);
        ada = register(acme);
        globexBoss = register(globex);
        administrator(boss, acme);
        administrator(globexBoss, globex);
    }

    // Helpers.

    private static String organization() {
        String slug = unique("quotas");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("quotas") + "@example.org";
        anonymous()
                .body(Map.of("organization", organization, "email", email, "displayName", "P", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    private static void administrator(String email, String organization) {
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", organization, email)
                .then()
                .statusCode(200);
    }

    private static RequestSpecification in(String person, String organization) {
        return as(person, PASSWORD).header("X-Mosaikit-Organization", organization);
    }

    private static String quotas(String organization) {
        return "/api/v1/organizations/" + organization + "/quotas";
    }

    private static Response upload(RequestSpecification who, String name, int size) {
        return who.config(RestAssured.config()
                        .encoderConfig(EncoderConfig.encoderConfig()
                                .appendDefaultContentCharsetToContentTypeIfUndefined(false)))
                .contentType("application/octet-stream")
                .body(new byte[size])
                .post(FILES + "?name=" + name);
    }

    private static void limit(String organization, String measure, Long limit) {
        Map<String, Object> body = new HashMap<>();
        body.put("limit", limit);
        asAdmin().body(body).put(quotas(organization) + "/" + measure).then().statusCode(200);
    }

    private long storage(String organization) {
        return asAdmin()
                .get(quotas(organization) + "/storage")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath()
                .getLong("used");
    }

    // Tests.

    @Test
    void withoutALimitStorageIsUnlimitedAndCounted() {
        in(boss, acme)
                .get(quotas(acme))
                .then()
                .statusCode(200)
                .body("[0].measure", equalTo("storage"))
                .body("[0].unit", equalTo("bytes"))
                .body("[0].kind", equalTo("gauge"))
                .body("[0].limit", nullValue())
                .body("[0].source", equalTo("none"))
                .body("[0].period", nullValue())
                .body("[0].used", equalTo(0));

        upload(in(ada, acme), "a.bin", 300).then().statusCode(201);
        upload(in(ada, acme), "b.bin", 200).then().statusCode(201);

        assertThat(storage(acme)).isEqualTo(500);
        assertThat(storage(globex)).isZero();
    }

    @Test
    void aFileBeyondTheStorageQuotaIsRefusedWithAProblemNamingTheLimit() {
        limit(acme, "storage", 1000L);
        String first = upload(in(ada, acme), "first.bin", 600)
                .then()
                .statusCode(201)
                .extract()
                .path("id");

        upload(in(ada, acme), "second.bin", 600)
                .then()
                .statusCode(403)
                .contentType("application/problem+json")
                .body("title", equalTo("Quota exceeded"))
                .body("status", equalTo(403))
                .body("detail", containsString("may keep 1000 bytes of Storage (storage)"))
                .body("detail", containsString("it keeps 600 bytes"))
                .body("quota.measure", equalTo("storage"))
                .body("quota.unit", equalTo("bytes"))
                .body("quota.limit", equalTo(1000))
                .body("quota.used", equalTo(600))
                .body("quota.requested", equalTo(600));
        // Nothing of the refused file was kept.
        assertThat(storage(acme)).isEqualTo(600);
        in(ada, acme).get(FILES).then().body("name", org.hamcrest.Matchers.not(hasItem("second.bin")));

        // Deleting a file makes room; another organization is not limited by this one.
        in(ada, acme).delete(FILES + "/" + first).then().statusCode(204);
        assertThat(storage(acme)).isZero();
        upload(in(ada, acme), "second.bin", 600).then().statusCode(201);
        upload(in(globexBoss, globex), "big.bin", 5000).then().statusCode(201);
    }

    @Test
    void twoUploadsAtTheSameTimeCannotBothPassTheLimit() throws Exception {
        limit(acme, "storage", 1000L);
        int uploads = 6;
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(uploads);
        try {
            List<Future<Integer>> answers = new ArrayList<>();
            for (int i = 0; i < uploads; i++) {
                String name = "same-time-" + i + ".bin";
                Callable<Integer> call = () -> {
                    start.await();
                    return upload(in(ada, acme), name, 600).statusCode();
                };
                answers.add(pool.submit(call));
            }
            start.countDown();
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> answer : answers) {
                statuses.add(answer.get());
            }
            assertThat(statuses).containsOnly(201, 403);
            assertThat(statuses).filteredOn(status -> status == 201).hasSize(1);
        } finally {
            pool.shutdownNow();
        }
        assertThat(storage(acme)).isEqualTo(600);
    }

    @Test
    void platformAdministratorsSetTheLimitsOfAnOrganizationWhichItsAdministratorsSee() {
        // Only platform administrators set them.
        in(boss, acme)
                .body(Map.of("limit", 10))
                .put(quotas(acme) + "/storage")
                .then()
                .statusCode(403);
        in(boss, acme).delete(quotas(acme) + "/storage").then().statusCode(403);

        asAdmin()
                .body(Map.of("limit", 5_000_000))
                .put(quotas(acme) + "/storage")
                .then()
                .statusCode(200)
                .body("limit", equalTo(5_000_000))
                .body("source", equalTo("organization"));
        in(boss, acme)
                .get(quotas(acme) + "/storage")
                .then()
                .statusCode(200)
                .body("limit", equalTo(5_000_000))
                .body("source", equalTo("organization"));

        // A null limit is none; removing it goes back to the default of the installation, none here.
        limit(acme, "storage", null);
        in(boss, acme)
                .get(quotas(acme) + "/storage")
                .then()
                .body("limit", nullValue())
                .body("source", equalTo("organization"));
        asAdmin().delete(quotas(acme) + "/storage").then().statusCode(200).body("source", equalTo("none"));

        asAdmin()
                .body(Map.of("limit", -1))
                .put(quotas(acme) + "/storage")
                .then()
                .statusCode(400);
        asAdmin()
                .body(Map.of("limit", 1))
                .put(quotas(acme) + "/org.example.none/calls")
                .then()
                .statusCode(404);

        // Every change is in the audit log of the organization.
        in(boss, acme)
                .queryParam("action", "quota.limit.set")
                .get("/api/v1/organizations/" + acme + "/audit-events")
                .then()
                .statusCode(200)
                .body("subject", hasItem("quota/storage"));
    }

    @Test
    void onlyTheAdministratorsOfTheOrganizationSeeItsQuotas() {
        in(ada, acme).get(quotas(acme)).then().statusCode(403);
        in(ada, acme).get(quotas(acme) + "/usage").then().statusCode(403);
        in(globexBoss, globex).get(quotas(acme)).then().statusCode(403);
        in(globexBoss, globex).get(quotas(acme) + "/usage").then().statusCode(403);
        asAdmin().get(quotas(acme)).then().statusCode(200);
        asAdmin().get(quotas(acme) + "/usage").then().statusCode(200);
        anonymous().get(quotas(acme)).then().statusCode(401);
    }

    @Test
    void theAdministratorsSeeTheConsumptionByMeasureAndPerson() {
        String adaId = in(ada, acme).get("/api/v1/accounts/me").path("id");
        String bossId = in(boss, acme).get("/api/v1/accounts/me").path("id");
        upload(in(ada, acme), "a.bin", 300).then().statusCode(201);
        upload(in(ada, acme), "b.bin", 100).then().statusCode(201);
        upload(in(boss, acme), "c.bin", 50).then().statusCode(201);

        String month = YearMonth.now(ZoneOffset.UTC).toString();
        Response report = in(boss, acme).get(quotas(acme) + "/usage");
        report.then()
                .statusCode(200)
                .body("period", equalTo(month))
                .body("rows.size()", equalTo(2))
                .body("rows[0].measure", equalTo("storage"))
                .body("rows[0].period", nullValue())
                .body("rows[0].person.id", equalTo(adaId))
                .body("rows[0].person.email", equalTo(ada))
                .body("rows[0].amount", equalTo(400))
                .body("rows[0].updatedAt", org.hamcrest.Matchers.notNullValue())
                .body("rows[1].person.id", equalTo(bossId))
                .body("rows[1].amount", equalTo(50));

        in(boss, acme)
                .queryParam("period", "2026-01")
                .get(quotas(acme) + "/usage")
                .then()
                .statusCode(200)
                .body("period", equalTo("2026-01"));
        in(boss, acme)
                .queryParam("period", "January")
                .get(quotas(acme) + "/usage")
                .then()
                .statusCode(400);
    }

    @Test
    void theFilesOfADeletedTeamLeaveTheCount() {
        String team = in(ada, acme)
                .body(Map.of("name", "Roads", "description", "", "visibility", "private"))
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
        upload(in(ada, acme), "plan.bin&team=" + team, 700).then().statusCode(201);
        upload(in(ada, acme), "mine.bin", 100).then().statusCode(201);
        assertThat(storage(acme)).isEqualTo(800);

        in(ada, acme).delete("/api/v1/teams/" + team).then().statusCode(204);
        assertThat(storage(acme)).isEqualTo(100);
    }
}
