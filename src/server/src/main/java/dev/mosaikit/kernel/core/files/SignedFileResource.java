// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import jakarta.annotation.security.PermitAll;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The files of signed links (MK-093), served without a session to whoever holds the link, with
 * ranges and cache validators as {@link FileResource} serves them. Every refusal is the same 404:
 * an expired or altered link never tells whether the file exists. The answers are private and
 * checked again every time, so that a rotated key or a deleted file stops the link at once.
 */
@Path(FileLink.ROOT + "/{organization}/{extension}")
@PermitAll
@Tag(name = "Files")
public class SignedFileResource {

    private final FileLinks links;

    public SignedFileResource(FileLinks links) {
        this.links = links;
    }

    @GET
    @Path("/{id}")
    @Produces(MediaType.WILDCARD)
    @Operation(
            summary = "Download a file through a signed link to it, without a session",
            description = "?expires=<epoch seconds>&creator=<account>?&signature=<base64url>, as POST "
                    + "/api/v1/files/{extension}/links made them; with Range, If-Range, If-None-Match and "
                    + "If-Modified-Since. 404 when the link expired, was altered, the file is not there, or the "
                    + "person who made the link no longer reads it.")
    public Response file(
            @PathParam("organization") String organization,
            @PathParam("extension") String extension,
            @PathParam("id") String id,
            @QueryParam("creator") String creator,
            @QueryParam("expires") String expires,
            @QueryParam("signature") String signature,
            @Context HttpHeaders headers) {
        return FileResponses.content(
                links.open(uuid(organization), extension, uuid(id), optional(creator), expires, signature),
                headers,
                FileResource.CACHE_CONTROL);
    }

    @GET
    @Path("/named/{name: .+}")
    @Produces(MediaType.WILDCARD)
    @Operation(
            summary = "Download a file under a signed link to a prefix, by its name, without a session",
            description =
                    "?prefix=<prefix>&team=<id>?&expires=<epoch seconds>&creator=<account>?&signature=<base64url>; the newest "
                            + "file of that name, which must start with the prefix; a file attached to a resource only while "
                            + "the person who made the link holds a level on it. As GET of a signed link to a file.")
    public Response named(
            @PathParam("organization") String organization,
            @PathParam("extension") String extension,
            @PathParam("name") String name,
            @QueryParam("prefix") String prefix,
            @QueryParam("team") String team,
            @QueryParam("creator") String creator,
            @QueryParam("expires") String expires,
            @QueryParam("signature") String signature,
            @Context HttpHeaders headers) {
        return FileResponses.content(
                links.openNamed(
                        uuid(organization),
                        extension,
                        prefix,
                        optional(team),
                        optional(creator),
                        name,
                        expires,
                        signature),
                headers,
                FileResource.CACHE_CONTROL);
    }

    /** An identifier of the query that may be absent. */
    private static UUID optional(String value) {
        return value == null || value.isEmpty() ? null : uuid(value);
    }

    /** An identifier of the path; a malformed one is refused as any other link. */
    private static UUID uuid(String value) {
        try {
            return UUID.fromString(value);
        } catch (IllegalArgumentException | NullPointerException _) {
            throw FileLinks.refused();
        }
    }
}
