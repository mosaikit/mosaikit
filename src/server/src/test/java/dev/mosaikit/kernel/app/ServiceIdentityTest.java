// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static io.restassured.RestAssured.given;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.hasKey;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.notNullValue;
import static org.hamcrest.Matchers.nullValue;

import dev.mosaikit.kernel.api.extension.ExtensionManifests;
import dev.mosaikit.kernel.api.extension.ManifestParseResult;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.ExtensionStatus;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.system.KernelVersion;
import io.agroal.api.AgroalDataSource;
import io.quarkus.test.junit.QuarkusMock;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.http.ContentType;
import io.restassured.specification.RequestSpecification;
import jakarta.enterprise.inject.Vetoed;
import jakarta.inject.Inject;
import java.nio.file.Path;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * Service identities (MK-124): created by a platform administrator with a key, shown once, and the
 * APIs of extensions they may call, which they reach without a person or an organization; refused on
 * everything else, the shell included; audited through the SERVICE channel; revoked at the next call;
 * rotated with two live keys; and allowed to check the session or the key of a person for a gateway.
 */
@QuarkusTest
@Tag("MK-124")
class ServiceIdentityTest {

    static final String API = "service-probe";

    private static final String IDENTITIES = "/api/v1/platform/service-identities";
    private static final String PROBE = "/api/v1/ext/" + API + "/caller";
    private static final String CHECK = "/api/v1/services/check";
    private static final String SESSION = "mosaikit-session";
    private static final String PASSWORD = "a long enough password";

    @Inject
    AgroalDataSource dataSource;

    @Inject
    ExtensionRegistry registry;

    @Inject
    KernelConfig config;

    @Inject
    KernelVersion version;

    private String organization;
    private String person;

    /** The registry of the kernel, with an active extension that declares the API of the probe. */
    @Vetoed
    static final class WithProbe extends ExtensionRegistry {

        private final List<InstalledExtension> all;

        WithProbe(KernelConfig config, KernelVersion version, List<InstalledExtension> real) {
            super(config, version, null, null);
            List<InstalledExtension> extensions = new ArrayList<>(real);
            extensions.add(probe());
            this.all = List.copyOf(extensions);
        }

        @Override
        public List<InstalledExtension> all() {
            return all;
        }

        @Override
        public List<InstalledExtension> active() {
            return all.stream().filter(InstalledExtension::isActive).toList();
        }

        @Override
        public Optional<InstalledExtension> findActive(String id) {
            return active().stream()
                    .filter(extension -> extension.key().equals(id))
                    .findFirst();
        }

        private static InstalledExtension probe() {
            Map<String, Object> tree = Map.of(
                    "id", "dev.mosaikit.test.serviceprobe",
                    "version", "1.0.0",
                    "name", "Service probe (test)",
                    "kind", List.of("service"),
                    "platform", ">=0.1 <1",
                    "backend", Map.of("jar", "lib/probe.jar", "api", API));
            var manifest = ((ManifestParseResult.Valid) ExtensionManifests.parse(tree)).manifest();
            return new InstalledExtension(
                    manifest.id(),
                    Path.of("extensions", "probe"),
                    Optional.of(manifest),
                    ExtensionStatus.ACTIVE,
                    List.of());
        }
    }

    @BeforeEach
    void setUp() {
        QuarkusMock.installMockForType(new WithProbe(config, version, registry.all()), ExtensionRegistry.class);
        organization = TestData.unique("services");
        person = TestData.unique("sam") + "@example.org";
        asAdmin()
                .body(Map.of("slug", organization, "name", "Acme services", "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        anonymous()
                .body(Map.of("organization", organization, "email", person, "displayName", "Sam", "password", PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
    }

    private static RequestSpecification withKey(String key) {
        return given().header("Authorization", "Bearer " + key).contentType(ContentType.JSON);
    }

    private static Map<String, Object> create(
            String name, List<String> apis, List<String> endpoints, List<String> organizations) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", name);
        body.put("description", "Checks requests in front of the map server");
        body.put("apis", apis);
        body.put("endpoints", endpoints);
        body.put("organizations", organizations);
        return asAdmin()
                .body(body)
                .post(IDENTITIES)
                .then()
                .statusCode(201)
                .extract()
                .path("$");
    }

    @SuppressWarnings("unchecked")
    private static String secret(Map<String, Object> created) {
        return (String)
                ((List<Map<String, Object>>) created.get("keys")).getFirst().get("secret");
    }

    private static List<Map<String, Object>> audit(String subject) {
        return asAdmin()
                .get("/api/v1/audit-events?limit=500")
                .then()
                .statusCode(200)
                .extract()
                .path("findAll { it.subject == '" + subject + "' }");
    }

    @Test
    void anAdministratorCreatesAnIdentityWhoseKeyReachesItsApisWithoutAPersonOrAnOrganization() throws SQLException {
        String name = TestData.unique("gateway");
        Map<String, Object> created = create(name, List.of(API), List.of(), List.of());
        String key = secret(created);
        assertThat(key).startsWith("mks_");
        assertThat(created)
                .containsEntry("name", name)
                .containsEntry("description", "Checks requests in front of the map server")
                .containsEntry("apis", List.of(API))
                .containsEntry("createdBy", "admin");

        String prefix = key.substring(0, 12);
        asAdmin()
                .get(IDENTITIES)
                .then()
                .statusCode(200)
                .body("endpoints", equalTo(List.of("check-key", "check-session")))
                .body("maxKeys", equalTo(2))
                .body("identities.find { it.name == '" + name + "' }.keys", hasSize(1))
                .body("identities.find { it.name == '" + name + "' }.keys[0].prefix", equalTo(prefix))
                .body("identities.find { it.name == '" + name + "' }.keys[0].lastUsedAt", nullValue())
                .body("identities.find { it.name == '" + name + "' }.keys[0]", not(hasKey("secret")));

        // The extension sees a service, without a person nor an organization.
        withKey(key)
                .get(PROBE)
                .then()
                .statusCode(200)
                .body("name", equalTo("service:" + name))
                .body("service", equalTo(true))
                .body("roles", equalTo(List.of("service")))
                .body("organization", nullValue());
        withKey(key).body("{}").post(PROBE).then().statusCode(200);
        asAdmin()
                .get(IDENTITIES)
                .then()
                .body("identities.find { it.name == '" + name + "' }.keys[0].lastUsedAt", notNullValue());

        // Only a digest is kept.
        try (var connection = dataSource.getConnection();
                var statement = connection.prepareStatement(
                        "select count(*) from mk_kernel.service_key where token_digest = ? or prefix = ?")) {
            statement.setString(1, key);
            statement.setString(2, key);
            try (var result = statement.executeQuery()) {
                assertThat(result.next()).isTrue();
                assertThat(result.getInt(1)).isZero();
            }
        }
        assertThat(audit(name)).extracting(event -> event.get("action")).containsExactly("service.identity.created");
    }

    @Test
    void anIdentityNeverSignsInToTheShellAndIsRefusedOnEveryApiItWasNotGiven() {
        String name = TestData.unique("map-server");
        String key = secret(create(name, List.of(API), List.of(), List.of()));

        for (String path : List.of(
                "/",
                "/api/v1/accounts/me",
                "/api/v1/identity",
                "/api/v1/platform/settings",
                IDENTITIES,
                "/api/v1/access-keys/current",
                "/api/v1/ext/another-api/items")) {
            withKey(key).get(path).then().statusCode(403);
        }
        withKey(key).body(Map.of()).post(CHECK).then().statusCode(403);
        withKey(key)
                .contentType(ContentType.URLENC)
                .formParam("username", "admin")
                .formParam("password", "test-admin-password")
                .post("/api/v1/accounts/session")
                .then()
                .statusCode(403)
                .header("Set-Cookie", nullValue());
        withKey(key)
                .get("/api/v1/ext/another-api/items")
                .then()
                .body("detail", equalTo("This service identity was not given this API."));

        // A person never reaches the endpoint of services.
        as(person, PASSWORD).body(Map.of("key", "mk_x")).post(CHECK).then().statusCode(403);

        List<Map<String, Object>> refused = audit(key.substring(0, 12)).stream()
                .filter(event -> "service.refused".equals(event.get("action")))
                .toList();
        assertThat(refused).hasSize(10);
        assertThat(refused).allSatisfy(event -> {
            assertThat(event).containsEntry("channel", "SERVICE").containsEntry("outcome", "DENIED");
            assertThat(event.get("actor")).isEqualTo("service:" + name);
            assertThat((String) event.get("detail")).contains("not-granted");
        });
    }

    @Test
    void everyCallIsAuditedOnceAnHourPerApiAndRevokingAKeyRefusesTheNextCall() {
        String name = TestData.unique("auditor");
        Map<String, Object> created = create(name, List.of(API), List.of(), List.of());
        String key = secret(created);
        for (int i = 0; i < 3; i++) {
            withKey(key).get(PROBE).then().statusCode(200);
        }
        String prefix = key.substring(0, 12);
        List<Map<String, Object>> used = audit(prefix).stream()
                .filter(event -> "service.used".equals(event.get("action")))
                .toList();
        assertThat(used).singleElement().satisfies(event -> {
            assertThat(event).containsEntry("channel", "SERVICE").containsEntry("actor", "service:" + name);
            assertThat((String) event.get("detail"))
                    .contains("\"api\":\"" + API + "\"")
                    .doesNotContain(key);
        });

        String id = (String) created.get("id");
        @SuppressWarnings("unchecked")
        String keyId = (String)
                ((List<Map<String, Object>>) created.get("keys")).getFirst().get("id");
        asAdmin().delete(IDENTITIES + "/{id}/keys/{key}", id, keyId).then().statusCode(204);

        // Right after the revocation, with no wait.
        withKey(key).get(PROBE).then().statusCode(401);
        asAdmin().delete(IDENTITIES + "/{id}/keys/{key}", id, keyId).then().statusCode(404);
        assertThat(audit(prefix))
                .extracting(event -> event.get("action"))
                .contains("service.key.revoked", "service.refused");
        assertThat(audit(prefix))
                .filteredOn(event -> "service.refused".equals(event.get("action")))
                .allSatisfy(event -> assertThat((String) event.get("detail")).contains("revoked"));
    }

    @Test
    void aKeyIsRotatedWithTwoLiveKeysAtMost() {
        Map<String, Object> created = create(TestData.unique("rotated"), List.of(API), List.of(), List.of());
        String id = (String) created.get("id");
        String old = secret(created);
        Map<String, Object> next = asAdmin()
                .post(IDENTITIES + "/{id}/keys", id)
                .then()
                .statusCode(201)
                .extract()
                .path("$");
        String fresh = (String) next.get("secret");
        assertThat(fresh).startsWith("mks_").isNotEqualTo(old);
        withKey(old).get(PROBE).then().statusCode(200);
        withKey(fresh).get(PROBE).then().statusCode(200);
        asAdmin().post(IDENTITIES + "/{id}/keys", id).then().statusCode(409);

        @SuppressWarnings("unchecked")
        String oldId = (String)
                ((List<Map<String, Object>>) created.get("keys")).getFirst().get("id");
        asAdmin().delete(IDENTITIES + "/{id}/keys/{key}", id, oldId).then().statusCode(204);
        withKey(old).get(PROBE).then().statusCode(401);
        withKey(fresh).get(PROBE).then().statusCode(200);
        asAdmin().post(IDENTITIES + "/{id}/keys", id).then().statusCode(201);
    }

    @Test
    void anIdentityActsOnAnOrganizationOnlyWhenItNamesOneItWasGiven() {
        String other = TestData.unique("other-services");
        asAdmin()
                .body(Map.of("slug", other, "name", "Green services"))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        Map<String, Object> created = create(TestData.unique("scoped"), List.of(API), List.of(), List.of(organization));
        assertThat(created).containsEntry("organizations", List.of(organization));
        String key = secret(created);

        withKey(key)
                .header("X-Mosaikit-Organization", organization)
                .get(PROBE)
                .then()
                .statusCode(200)
                .body("organization", equalTo(organization));
        withKey(key)
                .header("X-Mosaikit-Organization", other)
                .get(PROBE)
                .then()
                .statusCode(403)
                .body("detail", equalTo("This service identity may not act on the organization it named."));
        withKey(key).get(PROBE).then().statusCode(200).body("organization", nullValue());
    }

    @Test
    void changingTheGrantsAppliesAtTheNextCall() {
        Map<String, Object> created = create(TestData.unique("narrowed"), List.of(API), List.of(), List.of());
        String key = secret(created);
        withKey(key).get(PROBE).then().statusCode(200);
        asAdmin()
                .body(Map.of("description", "No longer", "apis", List.of("catalog")))
                .put(IDENTITIES + "/{id}", created.get("id"))
                .then()
                .statusCode(200)
                .body("apis", equalTo(List.of("catalog")))
                .body("keys", hasSize(1));
        withKey(key).get(PROBE).then().statusCode(403);
    }

    @Test
    void aGatewayChecksTheSessionOrTheKeyOfAPersonThroughTheKernel() {
        String key =
                secret(create(TestData.unique("gate"), List.of(), List.of("check-session", "check-key"), List.of()));
        String cookie = given().formParam("username", person)
                .formParam("password", PASSWORD)
                .post("/api/v1/accounts/session")
                .then()
                .statusCode(200)
                .extract()
                .cookie(SESSION);

        withKey(key)
                .body(Map.of("session", cookie, "organization", organization))
                .post(CHECK)
                .then()
                .statusCode(200)
                .body("kind", equalTo("session"))
                .body("account.username", equalTo(person))
                .body("account.displayName", equalTo("Sam"))
                .body("organization.slug", equalTo(organization))
                .body("roles", hasItem("organization-user"))
                .body("$", not(hasKey("key")));
        withKey(key).body(Map.of("session", "not-a-session")).post(CHECK).then().statusCode(401);
        withKey(key).body(Map.of()).post(CHECK).then().statusCode(400);

        String personal = as(person, PASSWORD)
                .body(Map.of("name", "Map client", "organization", organization))
                .post("/api/v1/accounts/me/access-keys")
                .then()
                .statusCode(201)
                .extract()
                .path("secret");
        withKey(key)
                .body(Map.of("key", personal))
                .post(CHECK)
                .then()
                .statusCode(200)
                .body("kind", equalTo("key"))
                .body("account.username", equalTo(person))
                .body("organization.slug", equalTo(organization))
                .body("key.name", equalTo("Map client"))
                .body("key.write", equalTo(false));
        withKey(key)
                .body(Map.of("key", "mk_" + "x".repeat(43)))
                .post(CHECK)
                .then()
                .statusCode(401);

        // Given only the session check, a service may not check keys.
        String sessionsOnly =
                secret(create(TestData.unique("sessions-only"), List.of(), List.of("check-session"), List.of()));
        withKey(sessionsOnly).body(Map.of("key", personal)).post(CHECK).then().statusCode(403);
        withKey(sessionsOnly).body(Map.of("session", cookie)).post(CHECK).then().statusCode(200);
    }

    @Test
    void onlyPlatformAdministratorsManageIdentitiesAndTheirInputIsChecked() {
        as(person, PASSWORD).get(IDENTITIES).then().statusCode(403);
        asAdmin()
                .body(Map.of("name", "Bad", "apis", List.of("Not An Api")))
                .post(IDENTITIES)
                .then()
                .statusCode(400);
        asAdmin()
                .body(Map.of("name", "Bad endpoint", "apis", List.of(), "endpoints", List.of("everything")))
                .post(IDENTITIES)
                .then()
                .statusCode(400);
        asAdmin()
                .body(Map.of("name", "Bad organization", "apis", List.of(), "organizations", List.of("nowhere-at-all")))
                .post(IDENTITIES)
                .then()
                .statusCode(400);
        asAdmin()
                .body(Map.of("name", " ", "apis", List.of()))
                .post(IDENTITIES)
                .then()
                .statusCode(400);
        String name = TestData.unique("twice");
        create(name, List.of(), List.of(), List.of());
        asAdmin()
                .body(Map.of("name", name, "apis", List.of()))
                .post(IDENTITIES)
                .then()
                .statusCode(409);
        withKey("mks_" + "x".repeat(43)).get(PROBE).then().statusCode(401);
    }
}
