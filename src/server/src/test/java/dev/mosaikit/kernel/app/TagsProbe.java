// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.Tags;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.TreeSet;
import java.util.function.Supplier;

/**
 * Stands for the Java code of an extension that tags its resources (MK-097): it calls the {@link Tags}
 * bean as an extension does, naming the extension in every call.
 */
@Path("/api/v1/test/tags")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
public class TagsProbe {

    private final Tags tags;

    public TagsProbe(Tags tags) {
        this.tags = tags;
    }

    @GET
    @Path("/{extension}/{type}/{id}")
    public Response of(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        return answer(() -> tags.of(new ResourceRef(extension, type, id)));
    }

    @POST
    @Path("/{extension}/{type}/{id}")
    public Response attach(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id,
            List<String> added) {
        return answer(() -> tags.attach(new ResourceRef(extension, type, id), added));
    }

    @PUT
    @Path("/{extension}/{type}/{id}")
    public Response replace(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id,
            List<String> replaced) {
        return answer(() -> tags.replace(new ResourceRef(extension, type, id), replaced));
    }

    @GET
    @Path("/{extension}/{type}")
    public Response tagged(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @QueryParam("tag") List<String> wanted) {
        return answer(() -> new TreeSet<>(tags.tagged(extension, type, wanted)));
    }

    private static Response answer(Supplier<Object> call) {
        try {
            return Response.ok(call.get()).build();
        } catch (NoSuchElementException e) {
            return Response.status(Response.Status.NOT_FOUND).build();
        } catch (IllegalArgumentException e) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(List.of(String.valueOf(e.getMessage())))
                    .build();
        }
    }
}
