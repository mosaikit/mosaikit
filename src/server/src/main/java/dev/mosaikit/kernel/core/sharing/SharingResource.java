// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.sharing.SharingDialog.GrantView;
import dev.mosaikit.kernel.core.sharing.SharingDialog.LinkAccess;
import dev.mosaikit.kernel.core.sharing.SharingDialog.LinkView;
import dev.mosaikit.kernel.core.sharing.SharingDialog.ResourceView;
import io.quarkus.security.Authenticated;
import jakarta.annotation.security.PermitAll;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * Sharing of the resources of extensions (MK-055), for the sharing dialog of the kernel: the same
 * for every resource type. Only the people who may share a resource see and change its grants.
 */
@Path("/api/v1/sharing")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Sharing")
public class SharingResource {

    /** Who to share with: {@code kind} person, group, organization or public; {@code id} for the first two. */
    public record SubjectRequest(String kind, UUID id) {}

    /** A grant to make or replace. */
    public record GrantRequest(SubjectRequest subject, String level) {}

    /** A link to make. */
    public record LinkRequestBody(String level, Instant expires, String password) {}

    /** A link to open, with its password if it has one. */
    public record OpenRequest(String token, String password) {}

    private final SharingDialog dialog;

    public SharingResource(SharingDialog dialog) {
        this.dialog = dialog;
    }

    @GET
    @Path("/resources/{extension}/{type}/{id}")
    @Operation(
            summary = "Open a resource in the sharing dialog",
            description = "The level of the signed-in person, whether they may share, and the levels and subjects"
                    + " of the type. 404 when the person has no level on the resource.")
    public ResourceView open(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        return dialog.open(ref(extension, type, id));
    }

    @GET
    @Path("/resources/{extension}/{type}/{id}/grants")
    @Operation(
            summary = "List the grants and links of a resource, with the names of their subjects",
            description = "For the people who may share it: 403 for the others with a level, 404 without.")
    public List<GrantView> grants(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        return dialog.grants(ref(extension, type, id));
    }

    @PUT
    @Path("/resources/{extension}/{type}/{id}/grants")
    @Operation(
            summary = "Share a resource with a subject, or replace its level",
            description = "Granting again to the same subject replaces its level, also with a lower one.")
    public GrantView grant(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id,
            GrantRequest request) {
        if (request == null || request.subject() == null) {
            throw new InvalidInputException(List.of("subject is required"));
        }
        return dialog.grant(
                ref(extension, type, id),
                request.subject().kind(),
                request.subject().id(),
                request.level());
    }

    @POST
    @Path("/resources/{extension}/{type}/{id}/links")
    @Operation(
            summary = "Make a link to a resource",
            description =
                    "The answer carries the secret of the link, which the kernel does not keep: it is shown" + " once.")
    public Response createLink(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id,
            LinkRequestBody request) {
        if (request == null) {
            throw new InvalidInputException(List.of("level and expires are required"));
        }
        LinkView link =
                dialog.createLink(ref(extension, type, id), request.level(), request.expires(), request.password());
        return Response.status(Response.Status.CREATED).entity(link).build();
    }

    @DELETE
    @Path("/grants/{grant}")
    @Operation(summary = "Revoke a grant or a link")
    public Response revoke(@PathParam("grant") UUID grant) {
        dialog.revoke(grant);
        return Response.noContent().build();
    }

    @POST
    @Path("/links/open")
    @PermitAll
    @Operation(
            summary = "Open a link, also without an account",
            description = "The resource and the level the link gives. 404 when the link is unknown, expired or"
                    + " revoked; 403 when its password is missing or wrong. Every use is audited.")
    public LinkAccess openLink(OpenRequest request) {
        return dialog.openLink(request == null ? null : request.token(), request == null ? null : request.password());
    }

    private static ResourceRef ref(String extension, String type, String id) {
        try {
            return new ResourceRef(extension, type, id);
        } catch (IllegalArgumentException e) {
            throw new InvalidInputException(List.of("resource " + e.getMessage()));
        }
    }
}
