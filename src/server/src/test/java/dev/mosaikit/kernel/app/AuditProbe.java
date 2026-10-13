// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import io.agroal.api.AgroalDataSource;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.sql.SQLException;
import java.util.Map;
import java.util.UUID;

/**
 * Stands for Java code running in a request, as the member role of the installation, that tries to
 * read, change or delete entries of the audit log with plain SQL (MK-059).
 */
@Path("/api/v1/test/audit")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class AuditProbe {

    private final AgroalDataSource dataSource;

    public AuditProbe(AgroalDataSource dataSource) {
        this.dataSource = dataSource;
    }

    /** How many entries of an organization the request sees. */
    @GET
    @Path("/count/{organization}")
    public int count(@PathParam("organization") UUID organization) throws SQLException {
        try (var connection = dataSource.getConnection();
                var statement = connection.prepareStatement(
                        "select count(*) from mk_kernel.audit_event where organization_id = ?")) {
            statement.setObject(1, organization);
            try (var result = statement.executeQuery()) {
                result.next();
                return result.getInt(1);
            }
        }
    }

    /** Tries to change the actor of an entry; answers the SQL state of the refusal, or how many rows changed. */
    @POST
    @Path("/update/{id}")
    public Map<String, Object> update(@PathParam("id") UUID id) {
        return run("update mk_kernel.audit_event set actor = 'forged' where id = ?", id);
    }

    /** Tries to delete an entry; answers the SQL state of the refusal, or how many rows went. */
    @POST
    @Path("/delete/{id}")
    public Map<String, Object> delete(@PathParam("id") UUID id) {
        return run("delete from mk_kernel.audit_event where id = ?", id);
    }

    private Map<String, Object> run(String sql, UUID id) {
        try (var connection = dataSource.getConnection();
                var statement = connection.prepareStatement(sql)) {
            statement.setObject(1, id);
            return Map.of("rows", statement.executeUpdate());
        } catch (SQLException e) {
            return Map.of("state", e.getSQLState());
        }
    }
}
