// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.Resources;
import io.agroal.api.AgroalDataSource;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * Stands for the Java code of an extension that registers its resources with the kernel (MK-054): it
 * calls the {@link Resources} bean as an extension does, naming the extension in every call.
 */
@Path("/api/v1/test/resources")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
public class ResourcesProbe {

    /** What the extension says about a resource; {@code parent} as {@code <extension>/<type>/<id>}. */
    public record Body(String title, String link, String parent) {

        Resources.Details details() {
            return new Resources.Details(title, link, parent == null ? null : ref(parent));
        }
    }

    private final Resources resources;
    private final AgroalDataSource dataSource;

    public ResourcesProbe(Resources resources, AgroalDataSource dataSource) {
        this.resources = resources;
        this.dataSource = dataSource;
    }

    @PUT
    @Path("/{extension}/{type}/{id}")
    public Response register(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id,
            Body body) {
        return answer(() -> resources.register(new ResourceRef(extension, type, id), body.details()));
    }

    @POST
    @Path("/{extension}/{type}/{id}")
    public Response update(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id,
            Body body) {
        return answer(() -> resources.update(new ResourceRef(extension, type, id), body.details()));
    }

    @DELETE
    @Path("/{extension}/{type}/{id}")
    public Response remove(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        return answer(() -> {
            resources.remove(new ResourceRef(extension, type, id));
            return null;
        });
    }

    @GET
    @Path("/{extension}/{type}/{id}")
    public Response find(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        return answer(() -> resources.find(new ResourceRef(extension, type, id)).orElseThrow());
    }

    @GET
    @Path("/{extension}/{type}")
    public Response list(
            @PathParam("extension") String extension, @PathParam("type") String type, @QueryParam("owner") UUID owner) {
        return answer(() -> resources.list(extension, type, owner));
    }

    /** The entries of the registry that plain SQL sees, without any filter: row-level security decides. */
    @GET
    @Path("/visible")
    public List<String> visible() throws SQLException {
        List<String> refs = new ArrayList<>();
        try (var connection = dataSource.getConnection();
                var statement = connection.createStatement();
                var result = statement.executeQuery("select extension_id, type, ref_id from mk_kernel.resource")) {
            while (result.next()) {
                refs.add(result.getString(1) + "/" + result.getString(2) + "/" + result.getString(3));
            }
        }
        return refs;
    }

    private static Response answer(Supplier<Object> call) {
        try {
            Object result = call.get();
            return result == null
                    ? Response.noContent().build()
                    : Response.ok(result).build();
        } catch (NoSuchElementException e) {
            return Response.status(Response.Status.NOT_FOUND).build();
        } catch (IllegalArgumentException e) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(List.of(String.valueOf(e.getMessage())))
                    .build();
        }
    }

    private static ResourceRef ref(String value) {
        String[] parts = value.split("/", 3);
        return new ResourceRef(parts[0], parts[1], parts[2]);
    }
}
