// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.permission.Permissions;
import io.agroal.api.AgroalDataSource;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.TreeSet;

/**
 * Stands for the Java backend of an extension that checks permissions (MK-056): it calls the
 * {@link Permissions} bean as an extension does, naming the extension in every call, and lets
 * {@code AccessDeniedException} reach the kernel, which answers 403.
 */
@Path("/api/v1/test/permissions")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class PermissionsProbe {

    private final Permissions permissions;
    private final AgroalDataSource dataSource;

    public PermissionsProbe(Permissions permissions, AgroalDataSource dataSource) {
        this.permissions = permissions;
        this.dataSource = dataSource;
    }

    /** An endpoint of the extension that needs the permission: 204 with it, 403 without. */
    @GET
    @Path("/require/{extension}/{permission}")
    public Response require(@PathParam("extension") String extension, @PathParam("permission") String permission) {
        try {
            permissions.require(extension, permission);
            return Response.noContent().build();
        } catch (IllegalArgumentException e) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(List.of(String.valueOf(e.getMessage())))
                    .build();
        }
    }

    /** What the extension tells its frontend: the names of the permissions the person has. */
    @GET
    @Path("/granted/{extension}")
    public Response granted(@PathParam("extension") String extension) {
        try {
            return Response.ok(new TreeSet<>(permissions.granted(extension))).build();
        } catch (IllegalArgumentException e) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(List.of(String.valueOf(e.getMessage())))
                    .build();
        }
    }

    /** The profiles and grants that plain SQL sees, without any filter: row-level security decides. */
    @GET
    @Path("/visible")
    public List<String> visible() throws SQLException {
        List<String> rows = new ArrayList<>();
        try (var connection = dataSource.getConnection();
                var statement = connection.createStatement();
                var profiles = statement.executeQuery("select name from mk_kernel.permission_profile")) {
            while (profiles.next()) {
                rows.add("profile:" + profiles.getString(1));
            }
        }
        try (var connection = dataSource.getConnection();
                var statement = connection.createStatement();
                var grants = statement.executeQuery(
                        "select extension_id || ':' || permission from mk_kernel.permission_grant")) {
            while (grants.next()) {
                rows.add("grant:" + grants.getString(1));
            }
        }
        return rows;
    }
}
