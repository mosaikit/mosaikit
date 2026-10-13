// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.DefaultValue;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.io.InputStream;
import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.OptionalLong;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The files of extensions (MK-041), for the shell and the frontends of extensions, in the
 * organization of the request: {@code /api/v1/files/<extension id>}. The content of an upload is the
 * body of the request, streamed, with its media type in {@code Content-Type}.
 */
@Path("/api/v1/files/{extension}")
@Authenticated
@Tag(name = "Files")
public class FileResource {

    /** The answers are private and checked again every time: who may read a file can change. */
    static final String CACHE_CONTROL = "private, no-cache";

    private final FileService files;
    private final FileLinks links;

    public FileResource(FileService files, FileLinks links) {
        this.files = files;
        this.links = links;
    }

    /**
     * A request for a signed link (MK-093): to one {@code file}, or to every file under a
     * {@code prefix} of names, of the organization or of a {@code team}; until {@code expires}, the
     * longest validity when absent.
     */
    public record NewLink(UUID file, String prefix, UUID team, Instant expires) {}

    /**
     * A signed link (MK-093): {@code url} opens the file, or the file named as the prefix; a file
     * under a prefix is at {@code base + name + "?" + query}.
     */
    public record LinkView(
            String url, String base, String query, UUID file, String prefix, UUID team, Instant expires) {

        static LinkView of(FileLinks.Made made, URI root) {
            String origin = root.toString().endsWith("/")
                    ? root.toString().substring(0, root.toString().length() - 1)
                    : root.toString();
            FileLink link = made.link();
            return new LinkView(
                    origin + made.path(),
                    origin + made.base(),
                    made.query(),
                    link.file(),
                    link.prefix(),
                    link.team(),
                    link.expires());
        }
    }

    @GET
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(
            summary = "List the files of an extension, newest first",
            description = "Those of the organization and of the teams of the person, or, with ?team=<id>, "
                    + "those of that team of the person only; a file attached to a resource only when the person "
                    + "holds a level on it or stored the file.")
    public List<FileView> list(
            @PathParam("extension") String extension,
            @QueryParam("team") UUID team,
            @QueryParam("offset") @DefaultValue("0") int offset,
            @QueryParam("limit") @DefaultValue("100") int limit) {
        return files.list(extension, team, offset, limit);
    }

    @POST
    @Consumes(MediaType.WILDCARD)
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(
            summary = "Store a file",
            description = "The body is the content, Content-Type its media type, ?name= its name. With "
                    + "?team=<id>, shared with that team of the person only; with ?resource=<type>/<id>, "
                    + "attached to a registered resource of the extension, which takes a level that edits it. 413 beyond "
                    + "mosaikit.files.max-size.")
    public Response store(
            @PathParam("extension") String extension,
            @QueryParam("name") String name,
            @QueryParam("team") UUID team,
            @QueryParam("resource") String resource,
            @HeaderParam(HttpHeaders.CONTENT_TYPE) String contentType,
            @HeaderParam(HttpHeaders.CONTENT_LENGTH) Long contentLength,
            @Context UriInfo uri,
            InputStream content) {
        FileView stored = files.store(
                extension,
                new FileService.Upload(name, contentType, team, resource(extension, resource)),
                content == null ? InputStream.nullInputStream() : content,
                contentLength == null ? OptionalLong.empty() : OptionalLong.of(contentLength));
        return Response.created(uri.getAbsolutePathBuilder()
                        .path(stored.id().toString())
                        .build())
                .entity(stored)
                .build();
    }

    @GET
    @Path("/{id}")
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(summary = "Get what the kernel knows of a file: name, type, size, checksum, owner, team")
    public FileView metadata(@PathParam("extension") String extension, @PathParam("id") UUID id) {
        return files.metadata(extension, id);
    }

    @GET
    @Path("/{id}/content")
    @Produces(MediaType.WILDCARD)
    @Operation(
            summary = "Download the content of a file",
            description = "With Range (one range of bytes), If-Range, If-None-Match and If-Modified-Since; "
                    + "the ETag is the SHA-256 of the content.")
    public Response content(
            @PathParam("extension") String extension, @PathParam("id") UUID id, @Context HttpHeaders headers) {
        return FileResponses.content(files.content(extension, id), headers, CACHE_CONTROL);
    }

    @POST
    @Path("/links")
    @Consumes(MediaType.APPLICATION_JSON)
    @Produces(MediaType.APPLICATION_JSON)
    @Operation(
            summary = "Make a signed, expiring link to a file or to a prefix of names",
            description = "Body {\"file\": <id>} for a file the person reads, or {\"prefix\": \"tiles/\", "
                    + "\"team\"?: <id>} for every file under the prefix of the organization or of a team of the "
                    + "person; \"expires\" at most mosaikit.files.link-max-validity from now. Anyone with the "
                    + "link downloads the files without a session until it expires (audited).")
    public Response link(@PathParam("extension") String extension, NewLink request, @Context UriInfo uri) {
        if (request == null || (request.file() == null) == (request.prefix() == null)) {
            throw new InvalidInputException(List.of("give either file or prefix"));
        }
        if (request.file() != null && request.team() != null) {
            throw new InvalidInputException(List.of("team goes with a prefix, not with a file"));
        }
        FileLinks.Made made = request.file() != null
                ? links.toFile(extension, request.file(), request.expires())
                : links.toPrefix(extension, request.prefix(), request.team(), request.expires());
        return Response.status(Response.Status.CREATED)
                .entity(LinkView.of(made, uri.getBaseUri()))
                .build();
    }

    @DELETE
    @Path("/{id}")
    @Operation(
            summary = "Delete a file",
            description = "Its owner, an owner of its team or an administrator of the organization may; for a "
                    + "file attached to a resource, its owner or a person with a level that edits the resource.")
    public Response delete(@PathParam("extension") String extension, @PathParam("id") UUID id) {
        files.delete(extension, id);
        return Response.noContent().build();
    }

    /** {@code <type>/<id>}: a resource of the extension. */
    private static ResourceRef resource(String extension, String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        int slash = value.indexOf('/');
        if (slash <= 0 || slash == value.length() - 1) {
            throw new InvalidInputException(List.of("resource must be <type>/<id>"));
        }
        try {
            return new ResourceRef(extension, value.substring(0, slash), value.substring(slash + 1));
        } catch (IllegalArgumentException e) {
            throw new InvalidInputException(List.of("resource: " + e.getMessage()));
        }
    }
}
