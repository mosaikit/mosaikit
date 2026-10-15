// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.Versions;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * Stands for the Java code of an extension that keeps the versions of its resources (MK-096): it
 * calls the {@link Versions} bean as an extension does, naming the extension in every reference.
 */
@Path("/api/v1/test/versions/{extension}/{type}/{id}")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
public class VersionsProbe {

    /** A snapshot in text of a media type, or a stored file. */
    public record Body(String text, String mediaType, UUID file) {

        Versions.Content content() {
            return file != null
                    ? Versions.Content.file(file)
                    : Versions.Content.snapshot(mediaType, text.getBytes(StandardCharsets.UTF_8));
        }
    }

    private final Versions versions;

    public VersionsProbe(Versions versions) {
        this.versions = versions;
    }

    @POST
    public Response save(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id,
            Body body) {
        return answer(() -> versions.save(new ResourceRef(extension, type, id), body.content()));
    }

    @GET
    public Response list(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        return answer(() -> versions.list(new ResourceRef(extension, type, id)));
    }

    @GET
    @Path("/{version}")
    public Response open(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id,
            @PathParam("version") UUID version) {
        return answer(() -> view(versions.open(new ResourceRef(extension, type, id), version)));
    }

    @POST
    @Path("/{version}/restore")
    public Response restore(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id,
            @PathParam("version") UUID version) {
        return answer(() -> versions.restore(new ResourceRef(extension, type, id), version));
    }

    private static Map<String, Object> view(Versions.Content content) {
        Map<String, Object> view = new HashMap<>();
        view.put("mediaType", content.mediaType());
        if (content.isFile()) {
            view.put("file", content.file().toString());
        } else {
            view.put("text", content.text());
        }
        return view;
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
