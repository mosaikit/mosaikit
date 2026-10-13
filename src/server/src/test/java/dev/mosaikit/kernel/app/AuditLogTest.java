// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.anyOf;
import static org.hamcrest.Matchers.contains;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.equalTo;
import static org.hamcrest.Matchers.everyItem;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.nullValue;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditEvent.Channel;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.audit.AuditRetention;
import io.quarkus.test.junit.QuarkusTest;
import io.restassured.path.json.JsonPath;
import io.restassured.specification.RequestSpecification;
import jakarta.inject.Inject;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.eclipse.microprofile.config.Config;
import org.eclipse.microprofile.config.ConfigProvider;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The tamper-evident audit log (MK-059): administrators read the entries of their own organization
 * only, nothing changes or deletes an entry, the verification finds an entry altered in the database
 * at its exact position, and the retention never deletes an entry younger than the minimum.
 */
@QuarkusTest
@Tag("MK-059")
class AuditLogTest {

    private static final String PASSWORD = "a long enough password";

    @Inject
    AuditLog log;

    @Inject
    AuditRetention retention;

    private String acme;
    private UUID acmeId;
    private String globex;
    private UUID globexId;
    private String boss;
    private String ada;

    @BeforeEach
    void organizations() {
        acme = organization();
        acmeId = id(acme);
        globex = organization();
        globexId = id(globex);
        boss = register(acme);
        ada = register(acme);
        asAdmin()
                .body(Map.of("roles", List.of("organization-admin", "organization-user")))
                .put("/api/v1/organizations/{slug}/members/{email}", acme, boss)
                .then()
                .statusCode(200);
    }

    @Test
    void administratorsListAndFilterTheEntriesOfTheirOwnOrganizationOnly() {
        log.append(Channel.WEB, ada, Optional.of(acmeId), "test.thing.created", "thing/1", ok(), Map.of("n", 1));
        log.append(Channel.ASSISTANT, boss, Optional.of(acmeId), "test.thing.deleted", "thing/2", ok(), Map.of());
        log.append(Channel.JOB, "system", Optional.of(globexId), "test.thing.created", "thing/1", ok(), Map.of());
        AuditEvent platform =
                log.append(Channel.WEB, "admin", Optional.empty(), "test.platform.changed", "platform", ok(), Map.of());

        in(boss, acme)
                .get(events(acme))
                .then()
                .statusCode(200)
                .body("organizationId", everyItem(equalTo(acmeId.toString())))
                .body("action", hasItem("organization.created"));
        in(boss, acme)
                .queryParam("action", "test.")
                .get(events(acme))
                .then()
                .statusCode(200)
                .body("action", contains("test.thing.deleted", "test.thing.created"))
                .body("channel", contains("ASSISTANT", "WEB"))
                .body("[1].detail", equalTo("{\"n\":1}"));
        assertThat(actions(acme, Map.of("actor", ada))).containsExactly("test.thing.created");
        assertThat(actions(acme, Map.of("channel", "assistant"))).containsExactly("test.thing.deleted");
        assertThat(actions(acme, Map.of("action", "test.", "subject", "thing/1")))
                .containsExactly("test.thing.created");
        assertThat(actions(acme, Map.of("action", "test.thing.created"))).containsExactly("test.thing.created");
        assertThat(actions(acme, Map.of("action", "test.", "offset", 1, "limit", 1)))
                .containsExactly("test.thing.created");
        String created = in(boss, acme)
                .queryParam("action", "test.thing.created")
                .get(events(acme))
                .path("[0].occurredAt");
        assertThat(actions(acme, Map.of("action", "test.", "from", created))).hasSize(2);
        assertThat(actions(acme, Map.of("action", "test.", "to", created))).isEmpty();
        in(boss, acme)
                .queryParam("channel", "carrier-pigeon")
                .get(events(acme))
                .then()
                .statusCode(400);
        in(boss, acme).queryParam("from", "yesterday").get(events(acme)).then().statusCode(400);

        // Not the entries of another organization, and not those of their own for a member.
        in(boss, acme).get(events(globex)).then().statusCode(403);
        in(boss, acme).get(events(globex) + "/verification").then().statusCode(403);
        in(boss, acme).get(events(globex) + "/retention").then().statusCode(403);
        in(ada, acme).get(events(acme)).then().statusCode(403);
        // The member role of the request sees no entry of another organization, even in plain SQL.
        in(ada, acme).get("/api/v1/test/audit/count/{id}", globexId).then().body(equalTo("0"));
        in(ada, acme).get("/api/v1/test/audit/count/{id}", acmeId).then().body(not(equalTo("0")));

        // Platform administrators see the entries of the platform.
        asAdmin()
                .queryParam("platform", true)
                .queryParam("limit", 500)
                .get("/api/v1/audit-events")
                .then()
                .statusCode(200)
                .body("organizationId", everyItem(nullValue()))
                .body("id", hasItem(platform.getId().toString()));
    }

    @Test
    void noRequestChangesNorDeletesAnEntry() {
        AuditEvent entry = log.append(Channel.WEB, ada, Optional.of(acmeId), "test.kept", "thing/1", ok(), Map.of());

        // The API has no way to change or delete an entry.
        for (String path : List.of("/api/v1/audit-events/" + entry.getId(), "/api/v1/audit-events")) {
            asAdmin().delete(path).then().statusCode(anyOf(equalTo(404), equalTo(405)));
            asAdmin().body("{}").put(path).then().statusCode(anyOf(equalTo(404), equalTo(405)));
            asAdmin().body("{}").patch(path).then().statusCode(anyOf(equalTo(404), equalTo(405)));
        }
        in(boss, acme).delete(events(acme)).then().statusCode(anyOf(equalTo(404), equalTo(405)));
        in(boss, acme).delete(events(acme) + "/" + entry.getId()).then().statusCode(anyOf(equalTo(404), equalTo(405)));

        // The database refuses it to the member role of requests: insufficient_privilege.
        in(ada, acme)
                .post("/api/v1/test/audit/update/{id}", entry.getId())
                .then()
                .body("state", equalTo("42501"));
        in(ada, acme)
                .post("/api/v1/test/audit/delete/{id}", entry.getId())
                .then()
                .body("state", equalTo("42501"));

        in(boss, acme)
                .queryParam("action", "test.kept")
                .get(events(acme))
                .then()
                .body("actor", contains(ada));
        in(boss, acme)
                .get(events(acme) + "/verification")
                .then()
                .statusCode(200)
                .body("intact", equalTo(true));
    }

    @Test
    void verificationReportsTheFirstAlteredEntryAtItsExactPosition() throws SQLException {
        List<AuditEvent> entries = appendFive(acmeId);
        JsonPath intact = in(boss, acme)
                .get(events(acme) + "/verification")
                .then()
                .statusCode(200)
                .extract()
                .jsonPath();
        assertThat(intact.getBoolean("intact")).isTrue();
        assertThat(intact.getLong("firstIndex")).isEqualTo(1);
        assertThat(intact.getLong("lastIndex")).isEqualTo(entries.getLast().getChainIndex());
        assertThat(intact.getLong("checked")).isEqualTo(entries.getLast().getChainIndex());

        // An entry changed in the database, by the owner of the table.
        AuditEvent third = entries.get(2);
        owner("update mk_kernel.audit_event set actor = 'someone else' where id = '" + third.getId() + "'");
        assertAltered(acme, third.getChainIndex(), third.getId(), "CHANGED");
        owner("update mk_kernel.audit_event set actor = '" + boss + "' where id = '" + third.getId() + "'");
        in(boss, acme).get(events(acme) + "/verification").then().body("intact", equalTo(true));

        // An entry changed and given the hash of its new content: the next entry no longer follows it.
        AuditEvent second = entries.get(1);
        owner("update mk_kernel.audit_event set detail = '{\"n\":99}' where id = '" + second.getId() + "'");
        owner("update mk_kernel.audit_event set hash = mk_kernel.audit_entry_hash(id, chain_index, organization_id,"
                + " occurred_at, channel, actor, action, subject, outcome, detail, previous_hash)"
                + " where id = '" + second.getId() + "'");
        assertAltered(acme, second.getChainIndex(), second.getId(), "CHANGED");

        // An entry deleted from the chain of another organization.
        List<AuditEvent> others = appendFive(globexId);
        AuditEvent fourth = others.get(3);
        owner("delete from mk_kernel.audit_event where id = '" + fourth.getId() + "'");
        asAdmin()
                .queryParam("organization", globexId)
                .get("/api/v1/audit-events/verification")
                .then()
                .statusCode(200)
                .body("intact", equalTo(false))
                .body("altered.index", equalTo((int) fourth.getChainIndex()))
                .body("altered.problem", equalTo("MISSING"))
                .body("altered.id", nullValue());
        // The last entry deleted: the chain is shorter than what the kernel appended.
        owner("delete from mk_kernel.audit_event where organization_id = '" + globexId + "' and chain_index > "
                + (fourth.getChainIndex() - 1));
        asAdmin()
                .queryParam("organization", globexId)
                .get("/api/v1/audit-events/verification")
                .then()
                .body("altered.index", equalTo((int) fourth.getChainIndex()))
                .body("altered.problem", equalTo("MISSING"));
    }

    @Test
    void retentionIsNeverBelowTheMinimumAndTheChainStillVerifies() throws Exception {
        in(boss, acme)
                .get(events(acme) + "/retention")
                .then()
                .statusCode(200)
                .body("minimumDays", equalTo(365))
                .body("retentionDays", nullValue());
        in(boss, acme)
                .body(Map.of("retentionDays", 30))
                .put(events(acme) + "/retention")
                .then()
                .statusCode(400);
        asAdmin()
                .body(Map.of("retentionDays", 1))
                .put("/api/v1/audit-events/retention")
                .then()
                .statusCode(400);
        in(boss, acme)
                .body(Map.of("retentionDays", 400))
                .put(events(acme) + "/retention")
                .then()
                .statusCode(200)
                .body("retentionDays", equalTo(400))
                .body("effectiveDays", equalTo(400));

        List<AuditEvent> entries = new ArrayList<>();
        for (int i = 1; i <= 3; i++) {
            entries.add(log.append(Channel.WEB, ada, Optional.of(acmeId), "test.early", "" + i, ok(), Map.of()));
        }
        Thread.sleep(5);
        entries.add(log.append(Channel.WEB, ada, Optional.of(acmeId), "test.late", "4", ok(), Map.of()));
        entries.add(log.append(Channel.WEB, ada, Optional.of(acmeId), "test.late", "5", ok(), Map.of()));
        AuditEvent fourth = entries.get(3);

        // 400 days after the fourth entry: everything before it goes, it stays.
        retention.apply(fourth.getOccurredAt().plus(Duration.ofDays(400)));
        List<String> left =
                in(boss, acme).queryParam("limit", 500).get(events(acme)).path("action");
        assertThat(left).containsExactly("audit.entries.deleted", "test.late", "test.late");
        in(boss, acme)
                .queryParam("action", "audit.entries.deleted")
                .get(events(acme))
                .then()
                .body("[0].channel", equalTo("JOB"))
                .body("[0].actor", equalTo("system"));
        in(boss, acme)
                .get(events(acme) + "/verification")
                .then()
                .body("intact", equalTo(true))
                .body("firstIndex", equalTo((int) fourth.getChainIndex()))
                .body("checked", equalTo(3));

        // A retention below the minimum, written in the database behind the API, is not applied.
        owner("update mk_kernel.audit_chain set retention_days = 1 where chain_id = '" + acmeId + "'");
        retention.apply(Instant.now().plus(Duration.ofDays(364)));
        assertThat((List<?>) in(boss, acme).get(events(acme)).path("id")).hasSize(3);
        // Past the minimum, it is.
        retention.apply(Instant.now().plus(Duration.ofDays(366)));
        in(boss, acme)
                .get(events(acme))
                .then()
                .body("action", contains("audit.entries.deleted"))
                .body("[0].detail", containsString("\"deleted\":3"))
                // The two entries left and the record of the first deletion.
                .body(
                        "[0].detail",
                        containsString("\"throughIndex\":" + (entries.getLast().getChainIndex() + 1)));
        in(boss, acme).get(events(acme) + "/verification").then().body("intact", equalTo(true));
    }

    @Test
    void theHashOfTheKernelIsTheHashOfTheMigration() throws SQLException {
        AuditEvent entry = log.append(
                Channel.EXTENSION,
                "zoë@example.org",
                Optional.of(acmeId),
                "test.ünïcode",
                null,
                ok(),
                Map.of("text", "日本語 \"quoted\"\nnew line"));
        AuditEvent platform = log.append(
                Channel.JOB, "system", Optional.empty(), "test.platform", "x", AuditEvent.Outcome.DENIED, null);
        for (AuditEvent each : List.of(entry, platform)) {
            try (Connection connection = ownerConnection();
                    var statement = connection.prepareStatement("select hash = mk_kernel.audit_entry_hash(id,"
                            + " chain_index, organization_id, occurred_at, channel, actor, action, subject, outcome,"
                            + " detail, previous_hash) from mk_kernel.audit_event where id = ?")) {
                statement.setObject(1, each.getId());
                try (var result = statement.executeQuery()) {
                    assertThat(result.next()).isTrue();
                    assertThat(result.getBoolean(1)).isTrue();
                }
            }
        }
    }

    // Helpers.

    private List<AuditEvent> appendFive(UUID organization) {
        List<AuditEvent> entries = new ArrayList<>();
        for (int i = 1; i <= 5; i++) {
            entries.add(log.append(
                    Channel.WEB, boss, Optional.of(organization), "test.step", "step/" + i, ok(), Map.of("n", i)));
        }
        return entries;
    }

    private void assertAltered(String organization, long index, UUID id, String problem) {
        in(boss, organization)
                .get(events(organization) + "/verification")
                .then()
                .statusCode(200)
                .body("intact", equalTo(false))
                .body("altered.index", equalTo((int) index))
                .body("altered.id", equalTo(id.toString()))
                .body("altered.problem", equalTo(problem));
    }

    private List<String> actions(String organization, Map<String, ?> query) {
        return in(boss, organization)
                .queryParams(query)
                .get(events(organization))
                .then()
                .statusCode(200)
                .extract()
                .path("action");
    }

    private static AuditEvent.Outcome ok() {
        return AuditEvent.Outcome.SUCCEEDED;
    }

    private static String events(String organization) {
        return "/api/v1/organizations/" + organization + "/audit-events";
    }

    private static String organization() {
        String slug = unique("audit");
        asAdmin()
                .body(Map.of("slug", slug, "name", slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static UUID id(String slug) {
        return UUID.fromString(
                asAdmin().get("/api/v1/organizations/{slug}", slug).path("id"));
    }

    private static String register(String organization) {
        String email = unique("audit") + "@example.org";
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

    /** Runs SQL as the owner of the tables, as someone with access to the database would. */
    private static void owner(String sql) throws SQLException {
        try (Connection connection = ownerConnection();
                var statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static Connection ownerConnection() throws SQLException {
        Config config = ConfigProvider.getConfig();
        return DriverManager.getConnection(
                config.getValue("quarkus.datasource.jdbc.url", String.class),
                config.getValue("quarkus.datasource.username", String.class),
                config.getValue("quarkus.datasource.password", String.class));
    }
}
