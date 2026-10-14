// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import static dev.mosaikit.kernel.app.Credentials.anonymous;
import static dev.mosaikit.kernel.app.Credentials.as;
import static dev.mosaikit.kernel.app.Credentials.asAdmin;
import static dev.mosaikit.kernel.app.TestData.unique;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.quarkus.test.junit.QuarkusTest;
import io.restassured.specification.RequestSpecification;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.eclipse.microprofile.config.Config;
import org.eclipse.microprofile.config.ConfigProvider;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The published views of people, organizations, memberships, teams and holders of permissions
 * (MK-123): what a login of an external service reads, what it cannot, and the columns that are a
 * contract across releases.
 */
@QuarkusTest
@Tag("MK-123")
class PublishedViewsTest {

    private static final String PASSWORD = "a long enough password";
    /** The login created at start from mosaikit.database.published-views.* (application.properties). */
    private static final String LOGIN = "mk_test_published";

    private static final String LOGIN_PASSWORD = "test-published-password";
    /** The reader role of the test database, named mosaikit. */
    private static final String READER = "mk_mosaikit_reader";

    /**
     * The contract: every view with its columns, in order, with their types. A change here is a
     * breaking change of the platform: see docs/development/published-views.md.
     */
    private static final Map<String, List<String>> CONTRACT = Map.of(
            "account",
                    List.of(
                            "id uuid",
                            "username character varying",
                            "display_name character varying",
                            "active boolean"),
            "organization", List.of("id uuid", "slug character varying", "name character varying"),
            "membership", List.of("account_id uuid", "organization_id uuid", "roles ARRAY"),
            "team", List.of("id uuid", "organization_id uuid", "parent_id uuid", "name character varying"),
            "team_member", List.of("team_id uuid", "account_id uuid", "role character varying"),
            "permission_holder",
                    List.of(
                            "organization_id uuid",
                            "extension_id character varying",
                            "permission character varying",
                            "source character varying",
                            "account_id uuid",
                            "team_id uuid"));

    private static Connection connect(String user, String password) throws SQLException {
        Config config = ConfigProvider.getConfig();
        return DriverManager.getConnection(
                config.getValue("quarkus.datasource.jdbc.url", String.class), user, password);
    }

    private static Connection owner() throws SQLException {
        Config config = ConfigProvider.getConfig();
        return connect(
                config.getValue("quarkus.datasource.username", String.class),
                config.getValue("quarkus.datasource.password", String.class));
    }

    private static Connection reader() throws SQLException {
        return connect(LOGIN, LOGIN_PASSWORD);
    }

    private static List<String> rows(Connection connection, String sql, Object... parameters) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int i = 0; i < parameters.length; i++) {
                statement.setObject(i + 1, parameters[i]);
            }
            List<String> rows = new ArrayList<>();
            try (ResultSet result = statement.executeQuery()) {
                int columns = result.getMetaData().getColumnCount();
                while (result.next()) {
                    List<String> values = new ArrayList<>();
                    for (int c = 1; c <= columns; c++) {
                        values.add(String.valueOf(result.getObject(c)));
                    }
                    rows.add(String.join("|", values));
                }
            }
            return rows;
        }
    }

    private static String organization() {
        String slug = unique("pub");
        asAdmin()
                .body(Map.of("slug", slug, "name", "Acme " + slug, "selfRegistration", true))
                .post("/api/v1/organizations")
                .then()
                .statusCode(201);
        return slug;
    }

    private static String register(String organization) {
        String email = unique("pub") + "@example.org";
        anonymous()
                .body(Map.of(
                        "organization",
                        organization,
                        "email",
                        email,
                        "displayName",
                        "Ada " + email,
                        "password",
                        PASSWORD))
                .post("/api/v1/accounts/registrations")
                .then()
                .statusCode(201);
        return email;
    }

    @Test
    void aLoginOfAnExternalServiceReadsPeopleOrganizationsAndMemberships() throws SQLException {
        String acme = organization();
        String ada = register(acme);
        String acmeId = asAdmin().get("/api/v1/organizations/{slug}", acme).path("id");

        try (Connection reader = reader()) {
            assertThat(rows(reader, "select id, name from mk_published.organization where slug = ?", acme))
                    .containsExactly(acmeId + "|Acme " + acme);
            List<String> account =
                    rows(reader, "select id, display_name, active from mk_published.account where username = ?", ada);
            assertThat(account).singleElement().asString().endsWith("|Ada " + ada + "|true");
            String adaId = account.get(0).split("\\|")[0];
            assertThat(rows(
                            reader,
                            "select array_to_string(roles, ',') from mk_published.membership "
                                    + "where account_id = ?::uuid and organization_id = ?::uuid",
                            adaId,
                            acmeId))
                    .containsExactly("organization-user");

            // A suspension shows at once.
            asAdmin()
                    .put("/api/v1/platform/accounts/{email}/suspension", ada)
                    .then()
                    .statusCode(200);
            assertThat(rows(reader, "select active from mk_published.account where username = ?", ada))
                    .containsExactly("false");
            asAdmin()
                    .delete("/api/v1/platform/accounts/{email}/suspension", ada)
                    .then()
                    .statusCode(200);
            assertThat(rows(reader, "select active from mk_published.account where username = ?", ada))
                    .containsExactly("true");
        }
    }

    @Test
    void aChangeOfTeamThroughTheApiShowsInTheViewsAtOnce() throws SQLException {
        String town = organization();
        String owner = register(town);
        String member = register(town);
        String townId = asAdmin().get("/api/v1/organizations/{slug}", town).path("id");
        RequestSpecification asOwner = as(owner, PASSWORD).header("X-Mosaikit-Organization", town);
        String team = asOwner.body(Map.of("name", "Roads", "description", "Roads", "visibility", "private"))
                .post("/api/v1/teams")
                .then()
                .statusCode(201)
                .extract()
                .path("id");
        String role =
                "select m.role from mk_published.team_member m join mk_published.account a on a.id = m.account_id "
                        + "where m.team_id = ?::uuid and a.username = ?";

        try (Connection reader = reader()) {
            assertThat(rows(
                            reader,
                            "select organization_id, parent_id, name from mk_published.team where id = ?::uuid",
                            team))
                    .containsExactly(townId + "|null|Roads");
            assertThat(rows(reader, role, team, owner)).containsExactly("owner");
            assertThat(rows(reader, role, team, member)).isEmpty();

            as(owner, PASSWORD)
                    .header("X-Mosaikit-Organization", town)
                    .body(Map.of("role", "member"))
                    .put("/api/v1/teams/" + team + "/members/" + member)
                    .then()
                    .statusCode(200);
            assertThat(rows(reader, role, team, member)).containsExactly("member");

            as(owner, PASSWORD)
                    .header("X-Mosaikit-Organization", town)
                    .body(Map.of("role", "owner"))
                    .put("/api/v1/teams/" + team + "/members/" + member)
                    .then()
                    .statusCode(200);
            assertThat(rows(reader, role, team, member)).containsExactly("owner");

            as(owner, PASSWORD)
                    .header("X-Mosaikit-Organization", town)
                    .delete("/api/v1/teams/" + team + "/members/" + member)
                    .then()
                    .statusCode(204);
            assertThat(rows(reader, role, team, member)).isEmpty();
        }
    }

    @Test
    void theLoginReadsNothingElseOfTheDatabase() throws SQLException {
        try (Connection owner = owner()) {
            // No right on any table, view or sequence outside the published views...
            assertThat(rows(owner, """
                            select n.nspname || '.' || c.relname from pg_class c
                            join pg_namespace n on n.oid = c.relnamespace
                            where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
                              and n.nspname not in ('pg_catalog', 'information_schema', 'mk_published')
                              and n.nspname not like 'pg_toast%'
                              and (has_table_privilege(?, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
                                   or (c.relkind = 'S' and has_sequence_privilege(?, c.oid, 'USAGE, SELECT, UPDATE')))
                            """, LOGIN, LOGIN))
                    .as("relations the login of the published views may use")
                    .isEmpty();
            // ...no access to the schema of the kernel or of any extension...
            assertThat(rows(owner, """
                            select nspname from pg_namespace
                            where nspname not in ('pg_catalog', 'information_schema', 'mk_published', 'public')
                              and nspname not like 'pg_t%'
                              and has_schema_privilege(?, oid, 'USAGE')
                            """, LOGIN))
                    .as("schemas the login of the published views may use")
                    .isEmpty();
            // ...and only reading on the published views.
            assertThat(rows(owner, """
                            select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname = 'mk_published'
                              and has_table_privilege(?, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')
                            """, LOGIN)).isEmpty();
            // The views run with the rights of their owner, the owner of the kernel.
            assertThat(rows(owner, """
                            select distinct pg_get_userbyid(c.relowner) = current_user from pg_class c
                            join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'mk_published'
                            """)).containsExactly("true");
        }

        try (Connection reader = reader()) {
            for (String sql : List.of(
                    "select password_hash from mk_kernel.user_account",
                    "select * from mk_kernel.organization_member",
                    "select mk_kernel.allows('dev.example', 'note', '1', 'view')",
                    "select * from mk_kernel.shared_link('x')",
                    "update mk_published.account set display_name = 'Eve'",
                    "delete from mk_published.organization",
                    "insert into mk_published.organization (id, slug, name) values (gen_random_uuid(), 'eve', 'Eve')",
                    "create view mk_published.eve as select 1")) {
                assertThatThrownBy(() -> rows(reader, sql), sql)
                        .isInstanceOf(SQLException.class)
                        .extracting(e -> ((SQLException) e).getSQLState())
                        .as(sql)
                        .isEqualTo("42501"); // insufficient_privilege
            }
        }
    }

    @Test
    void anAdministratorGrantsTheReaderRoleToALoginWithTheDocumentedSql() throws SQLException {
        String login = unique("geo_reader").replace('-', '_');
        try (Connection owner = owner();
                var statement = owner.createStatement()) {
            // docs/guide/administration.md, "Published views for external services"
            statement.execute("create role " + login + " login password 'a secret of the service'");
            statement.execute("grant " + READER + " to " + login);
        }
        try (Connection service = connect(login, "a secret of the service")) {
            assertThat(rows(service, "select count(*) from mk_published.organization"))
                    .hasSize(1);
            assertThatThrownBy(() -> rows(service, "select * from mk_kernel.team"))
                    .isInstanceOf(SQLException.class);
        }
    }

    @Test
    void theViewsKeepTheirNamesAndColumns() throws SQLException {
        Map<String, List<String>> published = new LinkedHashMap<>();
        try (Connection owner = owner()) {
            for (String row : rows(owner, """
                    select table_name, column_name || ' ' || data_type from information_schema.columns
                    where table_schema = 'mk_published' order by table_name, ordinal_position
                    """)) {
                String[] parts = row.split("\\|");
                published.computeIfAbsent(parts[0], view -> new ArrayList<>()).add(parts[1]);
            }
        }
        assertThat(published)
                .as("The published views (MK-123) are a contract with external services: renaming, removing "
                        + "or changing a view or a column is a breaking change of the platform. Announce it "
                        + "under a breaking change in CHANGELOG.md, update docs/development/published-views.md, "
                        + "then this test. Adding a view or a column at the end is compatible, and still updates both.")
                .containsExactlyInAnyOrderEntriesOf(CONTRACT);
    }
}
