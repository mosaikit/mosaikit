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
import java.util.Locale;
import java.util.Optional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;
import org.postgresql.PGConnection;

/**
 * The reader role of the published views (MK-123): read-only views of people, organizations,
 * memberships and teams, in schema {@value #SCHEMA}, for services outside the kernel. At start, after
 * the migrations, the kernel creates the role {@code mk_<database>_reader} (no login), which may read
 * those views and nothing else, and, when {@code mosaikit.database.published-views.login} is set, a
 * login that holds it.
 *
 * <p>The views run with the rights of their owner, the owner of the kernel: the reader needs no right
 * on the kernel tables, and gets none.
 */
@ApplicationScoped
public class PublishedViews {

    private static final Logger LOG = Logger.getLogger(PublishedViews.class);

    /** The schema of the published views, created by migration V21. */
    public static final String SCHEMA = "mk_published";

    /** Longest name of a PostgreSQL role. */
    private static final int MAX_ROLE = 63;

    /** Marks a login created by the kernel, the only kind of existing role whose password it sets. */
    private static final String MARK = "Mosaikit published views login of database ";

    private final AgroalDataSource dataSource;
    private final Optional<String> login;
    private final Optional<String> password;
    private volatile String role;

    public PublishedViews(
            AgroalDataSource dataSource,
            @ConfigProperty(name = "mosaikit.database.published-views.login") Optional<String> login,
            @ConfigProperty(name = "mosaikit.database.published-views.password") Optional<String> password) {
        this.dataSource = dataSource;
        this.login = login.map(String::strip).filter(name -> !name.isEmpty());
        this.password = password.filter(secret -> !secret.isEmpty());
    }

    /** The reader role of the installation, once {@link #prepare} created it. */
    public Optional<String> role() {
        return Optional.ofNullable(role);
    }

    /**
     * Creates the reader role if needed, grants it the published views and, when configured, creates
     * the login of external services. Without the right to create roles the published views stay
     * unreadable, with a warning; a configured login that cannot be created stops the start.
     */
    public void prepare() {
        if (login.isPresent() && password.isEmpty()) {
            throw new IllegalStateException("mosaikit.database.published-views.login is set without "
                    + "mosaikit.database.published-views.password");
        }
        try (Connection connection = dataSource.getConnection()) {
            String database = database(connection);
            String name = roleName(database);
            try (Statement statement = connection.createStatement()) {
                if (!exists(connection, name)) {
                    // Role names cannot be bound as parameters; they are quoted identifiers.
                    // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
                    statement.execute("create role " + RowSecurity.quote(name) + " nologin");
                }
                String r = RowSecurity.quote(name);
                // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
                statement.execute("grant usage on schema " + SCHEMA + " to " + r);
                // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
                statement.execute("grant select on all tables in schema " + SCHEMA + " to " + r);
            }
            role = name;
            LOG.infof("Published views: schema %s readable by role %s", SCHEMA, name);
            if (login.isPresent()) {
                createLogin(connection, database, login.get(), name);
            }
        } catch (SQLException e) {
            if (login.isPresent()) {
                throw new IllegalStateException(
                        "Cannot create the login of the published views "
                                + "(mosaikit.database.published-views.login): " + e.getMessage(),
                        e);
            }
            LOG.warnf(
                    "Published views: cannot create their reader role (%s); an administrator of the "
                            + "database creates it as described in the administration guide.",
                    e.getMessage());
        }
    }

    /*
     * The password is never part of an SQL text: pgjdbc hashes it with SCRAM-SHA-256 on the client
     * and sends the hash, so that it appears neither in the logs of the kernel nor in those of the
     * server. A role that already exists is changed only when the kernel created it (MARK), so that a
     * misconfigured name never takes over the role of somebody else.
     */
    private void createLogin(Connection connection, String database, String user, String reader) throws SQLException {
        String mark = MARK + database;
        Optional<String> existing = comment(connection, user);
        if (existing.isEmpty()) {
            try (Statement statement = connection.createStatement()) {
                String u = RowSecurity.quote(user);
                // Role names cannot be bound as parameters; they are quoted identifiers.
                // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
                statement.execute("create role " + u + " login nosuperuser nocreatedb nocreaterole");
            }
            try (PreparedStatement statement =
                    connection.prepareStatement("select format('comment on role %I is %L', ?::text, ?::text)")) {
                statement.setString(1, user);
                statement.setString(2, mark);
                try (ResultSet result = statement.executeQuery();
                        Statement comment = connection.createStatement()) {
                    result.next();
                    comment.execute(result.getString(1));
                }
            }
        } else if (!mark.equals(existing.get())) {
            throw new SQLException("role " + user + " exists and was not created by the kernel for the "
                    + "published views: choose another name, or grant " + reader + " to it by hand");
        }
        connection
                .unwrap(PGConnection.class)
                .alterUserPassword(user, password.orElseThrow().toCharArray(), "scram-sha-256");
        try (Statement statement = connection.createStatement()) {
            // Role names cannot be bound as parameters; they are quoted identifiers.
            // nosemgrep: java.lang.security.audit.formatted-sql-string.formatted-sql-string
            statement.execute("grant " + RowSecurity.quote(reader) + " to " + RowSecurity.quote(user));
        }
        LOG.infof("Published views: login %s reads them", user);
    }

    /** The comment of a role: empty when the role does not exist, "" when it has none. */
    private static Optional<String> comment(Connection connection, String name) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(
                "select coalesce(shobj_description(oid, 'pg_authid'), '') from pg_roles where rolname = ?")) {
            statement.setString(1, name);
            try (ResultSet result = statement.executeQuery()) {
                return result.next() ? Optional.of(result.getString(1)) : Optional.empty();
            }
        }
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

    /** The reader role of a database, one per installation even when several share a server. */
    static String roleName(String database) {
        String cleaned = database.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_]", "_");
        String name = "mk_" + cleaned + "_reader";
        return name.length() <= MAX_ROLE ? name : "mk_" + cleaned.substring(0, MAX_ROLE - 10) + "_reader";
    }
}
