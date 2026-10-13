// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.files.FileContent;
import dev.mosaikit.kernel.api.files.FileStorage;
import dev.mosaikit.kernel.api.files.StoredFile;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.UUID;
import java.util.concurrent.Callable;

/**
 * Stands for the Java code of an extension that keeps files through the kernel (MK-041): it calls the
 * {@link FileStorage} bean as an extension does, naming the extension in every call, and holds no
 * setting of the store.
 */
@Path("/api/v1/test/files/{extension}")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class FilesProbe {

    /** A file read through the bean: what the kernel knows of it, and its content as text. */
    public record Read(StoredFile file, String content) {}

    private final FileStorage files;

    public FilesProbe(FileStorage files) {
        this.files = files;
    }

    @POST
    @Consumes(MediaType.WILDCARD)
    public Response store(
            @PathParam("extension") String extension,
            @QueryParam("name") String name,
            @QueryParam("team") UUID team,
            @QueryParam("resource") String resource,
            @HeaderParam(HttpHeaders.CONTENT_TYPE) String type,
            InputStream content) {
        FileStorage.NewFile file = FileStorage.NewFile.of(name, type).forTeam(team);
        if (resource != null) {
            String[] parts = resource.split("/", 2);
            file = file.attachedTo(new ResourceRef(extension, parts[0], parts[1]));
        }
        FileStorage.NewFile stored = file;
        return answer(() -> files.store(extension, stored, content));
    }

    @GET
    @Path("/{id}")
    public Response read(@PathParam("extension") String extension, @PathParam("id") UUID id) {
        return answer(() -> {
            try (FileContent content = files.read(extension, id)) {
                return new Read(content.file(), new String(content.stream().readAllBytes(), StandardCharsets.UTF_8));
            }
        });
    }

    @GET
    @Path("/{id}/metadata")
    public Response find(@PathParam("extension") String extension, @PathParam("id") UUID id) {
        return answer(() -> files.find(extension, id).orElseThrow());
    }

    @GET
    public Response list(@PathParam("extension") String extension, @QueryParam("team") UUID team) {
        return answer(() -> files.list(extension, team, 0, 100));
    }

    @POST
    @Path("/{id}/link")
    public Response link(
            @PathParam("extension") String extension,
            @PathParam("id") UUID id,
            @QueryParam("validFor") String validFor) {
        return answer(() -> files.link(extension, id, validFor == null ? null : Duration.parse(validFor)));
    }

    @POST
    @Path("/links")
    public Response linkToPrefix(
            @PathParam("extension") String extension,
            @QueryParam("prefix") String prefix,
            @QueryParam("team") UUID team,
            @QueryParam("validFor") String validFor) {
        return answer(() -> files.linkToPrefix(
                extension, prefix == null ? "" : prefix, team, validFor == null ? null : Duration.parse(validFor)));
    }

    @DELETE
    @Path("/{id}")
    public Response delete(@PathParam("extension") String extension, @PathParam("id") UUID id) {
        return answer(() -> {
            files.delete(extension, id);
            return null;
        });
    }

    private static Response answer(Callable<Object> call) {
        try {
            Object result = call.call();
            return result == null
                    ? Response.noContent().build()
                    : Response.ok(result).build();
        } catch (NoSuchElementException e) {
            return Response.status(Response.Status.NOT_FOUND).build();
        } catch (IllegalArgumentException e) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(List.of(String.valueOf(e.getMessage())))
                    .build();
        } catch (SecurityException e) {
            return Response.status(Response.Status.FORBIDDEN).build();
        } catch (IOException e) {
            return Response.serverError().build();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
