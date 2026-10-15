// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.data;

import io.agroal.api.AgroalDataSource;
import jakarta.enterprise.context.ApplicationScoped;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

/**
 * Row-level security of the data of organizations (MK-019, ADR-0018). During a request that acts
 * on an organization, every connection runs as a member role of the installation, which owns no
 * table, and carries the organization in {@code mosaikit.organization}: the policies of the extension
 * tables ({@code organization_id = mk_kernel.current_organization()}) then apply to every query,
 * including those of third-party extensions, even when they forget to filter. Owners and superusers
 * bypass policies, so that migrations and the kernel at start see every row.
 */
@ApplicationScoped
public class RowSecurity {

    private static final Logger LOG = Logger.getLogger(RowSecurity.class);

    /** Longest name of a PostgreSQL role. */
    private static final int MAX_ROLE = 63;

    private final AgroalDataSource dataSource;
    private final boolean enabled;
    private final String kernelSchema;
    private volatile String role;

    public RowSecurity(
            AgroalDataSource dataSource,
            @ConfigProperty(name = "mosaikit.database.row-security", defaultValue = "true") boolean enabled,
            @ConfigProperty(name = "quarkus.hibernate-orm.database.default-schema", defaultValue = "mk_kernel")
                    String kernelSchema) {
        this.dataSource = dataSource;
        this.enabled = enabled;
        this.kernelSchema = kernelSchema;
    }

    /** The member role that requests with an organization run as, once {@link #prepare} ran. */
    public Optional<String> role() {
        return Optional.ofNullable(role);
    }

    /**
     * Creates the member role of the installation if needed and grants it the data of the kernel and
     * of the given extension schemas. Called at start, after the migrations.
     *
     * @throws IllegalStateException when the database user may not create or use the role
     */
    public void prepare(List<String> extensionSchemas) {
        if (!enabled) {
            LOG.warn("Row-level security is off (mosaikit.database.row-security=false): the data of "
                    + "organizations are kept apart only by the code of the extensions.");
            return;
        }
        try (Connection connection = dataSource.getConnection();
                Statement statement = connection.createStatement()) {
            String name = roleName(database(connection));
            if (!exists(connection, name)) {
                statement.execute("create role " + quote(name) + " nologin");
            }
            statement.execute("grant " + quote(name) + " to current_user");
            for (String schema : schemas(extensionSchemas)) {
                grant(statement, schema, name);
            }
            appendOnly(statement, name);
            readOnly(statement, name);
            ownerOnly(statement, name);
            role = name;
            LOG.infof("Row-level security on: requests of organizations run as role %s", name);
        } catch (SQLException e) {
            throw new IllegalStateException(
                    "Cannot prepare row-level security: the database user needs CREATEROLE, or a role "
                            + "created by the administrator of the database; "
                            + "mosaikit.database.row-security=false turns it off. " + e.getMessage(),
                    e);
        }
    }

    private List<String> schemas(List<String> extensionSchemas) {
        return java.util.stream.Stream.concat(java.util.stream.Stream.of(kernelSchema), extensionSchemas.stream())
                .distinct()
                .toList();
    }

    /*
     * GRANT takes identifiers, which a prepared statement cannot bind: the schema and the role are
     * quoted as identifiers by quote(), so they cannot end the identifier nor add SQL.
     */
    private static void grant(Statement statement, String schema, String role) throws SQLException {
        String s = quote(schema);
        String r = quote(role);
        // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
        statement.execute("grant usage on schema " + s + " to " + r);
        // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
        statement.execute("grant select, insert, update, delete on all tables in schema " + s + " to " + r);
        // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
        statement.execute("grant usage, select, update on all sequences in schema " + s + " to " + r);
        // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
        statement.execute("grant execute on all functions in schema " + s + " to " + r);
    }

    /*
     * The audit log is append-only (MK-059): the member role may read and add the entries of its
     * organization, never change nor delete one, and has nothing to do with the heads of the chains,
     * which only the kernel moves, as the owner.
     */
    private void appendOnly(Statement statement, String role) throws SQLException {
        String r = quote(role);
        String s = quote(kernelSchema);
        // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
        statement.execute("revoke update, delete, truncate on " + s + ".audit_event from " + r);
        // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
        statement.execute("revoke all on " + s + ".audit_chain from " + r);
        // The external origins of the content security policy (MK-128) are of the installation: no
        // request, and no SQL of an extension, may read or widen them; only the kernel, as the owner.
        // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
        statement.execute("revoke all on " + s + ".csp_origin from " + r);
        // The sites that may frame the views of an organization (MK-100) decide who may frame the
        // installation: only the kernel, as the owner, for the administrators of the organization.
        // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
        statement.execute("revoke all on " + s + ".embed_site from " + r);
    }

    /**
     * The tables of the installation that requests may read but only the kernel writes, as the owner
     * ({@link KernelWrites}): accounts and what signs them in, service identities, organizations, the
     * settings of the platform and the levels of sharing. They have no row-level security and no
     * organization, so a statement of an extension run as the member role would change them for the
     * whole installation.
     */
    static final List<String> READ_ONLY = List.of(
            "platform_setting",
            "user_account",
            "account_session",
            "remember_token",
            "email_confirmation",
            "password_link",
            "access_key",
            "service_identity",
            "service_key",
            "organization",
            "organization_email_domain",
            "sharing_level");

    /*
     * Table names are constants of this class and the schema and the role are quoted by quote(), so
     * they cannot end the identifier nor add SQL.
     */
    private void readOnly(Statement statement, String role) throws SQLException {
        String r = quote(role);
        String s = quote(kernelSchema);
        for (String table : READ_ONLY) {
            // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
            statement.execute("revoke insert, update, delete, truncate on " + s + "." + quote(table) + " from " + r);
        }
    }

    /*
     * The credentials of the installation (MK-127) belong to no organization: the member role, and so
     * every request and the SQL of every extension, has no right on them; only the kernel reads them,
     * as the owner. The table has row-level security without a policy too, so a grant added by mistake
     * still shows no row.
     */
    private void ownerOnly(Statement statement, String role) throws SQLException {
        String r = quote(role);
        String s = quote(kernelSchema);
        // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
        statement.execute("revoke all on " + s + ".installation_secret from " + r);
        // The contents of files queued for removal (#102) may be of any organization, or of none left.
        // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
        statement.execute("revoke all on " + s + ".file_removal from " + r);
    }

    private static String database(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement();
                ResultSet result = statement.executeQuery("select current_database()")) {
            result.next();
            return result.getString(1);
        }
    }

    private static boolean exists(Connection connection, String name) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement("select 1 from pg_roles where rolname = ?")) {
            statement.setString(1, name);
            try (ResultSet result = statement.executeQuery()) {
                return result.next();
            }
        }
    }

    /** The member role of a database, one per installation even when several share a server. */
    static String roleName(String database) {
        String cleaned = database.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_]", "_");
        String name = "mk_" + cleaned + "_member";
        return name.length() <= MAX_ROLE ? name : "mk_" + cleaned.substring(0, MAX_ROLE - 10) + "_member";
    }

    /** A PostgreSQL quoted identifier: in double quotes, with every double quote doubled. */
    static String quote(String identifier) {
        return "\"" + identifier.replace("\"", "\"\"") + "\"";
    }
}
