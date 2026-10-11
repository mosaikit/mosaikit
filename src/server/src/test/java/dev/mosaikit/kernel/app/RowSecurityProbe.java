// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import io.agroal.api.AgroalDataSource;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Stands for the Java code of a third-party plugin that forgets to filter by organization
 * (MK-019): it reads and writes its table with plain SQL.
 */
@Path("/api/v1/test/scoped-notes")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class RowSecurityProbe {

    private final AgroalDataSource dataSource;

    public RowSecurityProbe(AgroalDataSource dataSource) {
        this.dataSource = dataSource;
    }

    @GET
    public List<String> all() throws SQLException {
        List<String> texts = new ArrayList<>();
        try (var connection = dataSource.getConnection();
                var statement = connection.createStatement();
                var result = statement.executeQuery("select text from p_test_schema.scoped_note order by id")) {
            while (result.next()) {
                texts.add(result.getString(1));
            }
        }
        return texts;
    }

    @POST
    @Consumes(MediaType.TEXT_PLAIN)
    public Response add(String text) throws SQLException {
        try (var connection = dataSource.getConnection();
                var statement =
                        connection.prepareStatement("insert into p_test_schema.scoped_note (text) values (?)")) {
            statement.setString(1, text);
            statement.executeUpdate();
        }
        return Response.noContent().build();
    }

    @POST
    @Path("/{organization}")
    @Consumes(MediaType.TEXT_PLAIN)
    public Response addTo(@PathParam("organization") UUID organization, String text) {
        try (var connection = dataSource.getConnection();
                var statement = connection.prepareStatement(
                        "insert into p_test_schema.scoped_note (organization_id, text) values (?, ?)")) {
            statement.setObject(1, organization);
            statement.setString(2, text);
            statement.executeUpdate();
            return Response.noContent().build();
        } catch (SQLException e) {
            return Response.status(Response.Status.FORBIDDEN)
                    .entity(List.of(e.getSQLState()))
                    .build();
        }
    }
}
