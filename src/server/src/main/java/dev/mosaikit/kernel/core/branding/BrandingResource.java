// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.branding;

import dev.mosaikit.kernel.core.files.FileResponses;
import io.quarkus.security.Authenticated;
import jakarta.annotation.security.PermitAll;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.io.InputStream;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The branding of an organization (MK-074): public, for its sign-in page and its shell; changed by
 * the administrators of the organization only.
 */
@Path("/api/v1/organizations/{slug}/branding")
@Produces(MediaType.APPLICATION_JSON)
@Tag(name = "Branding")
public class BrandingResource {

    /** Images change address when they change: a copy may be kept, and checked again after a day. */
    private static final String CACHE = "public, max-age=86400";

    private final BrandingService branding;

    public BrandingResource(BrandingService branding) {
        this.branding = branding;
    }

    @GET
    @PermitAll
    @Operation(
            summary = "Get the branding of an organization",
            description = "Public, for the sign-in page of the organization: display name, accent color, the tokens"
                    + " of the theme it changed and the addresses of its images. An organization without branding,"
                    + " or that does not exist, answers with null values.")
    public BrandingView get(@PathParam("slug") String slug) {
        return branding.view(slug);
    }

    @PUT
    @Authenticated
    @Consumes(MediaType.APPLICATION_JSON)
    @Operation(
            summary = "Set the display name, the accent color and the theme tokens of an organization",
            description =
                    "Administrators of the organization. {\"displayName\", \"accent\": \"#rrggbb\", \"light\":"
                            + " {token: color}, \"dark\": {token: color}}; a missing value goes back to the installation. Audited.")
    public BrandingView change(@PathParam("slug") String slug, @Valid @NotNull BrandingRequest request) {
        return branding.change(slug, request);
    }

    @GET
    @Path("/images/{kind}")
    @PermitAll
    @Produces(MediaType.WILDCARD)
    @Operation(
            summary = "Get an image of the branding of an organization",
            description = "Public. kind: logo, logo-dark, icon or favicon.")
    public Response image(
            @PathParam("slug") String slug, @PathParam("kind") String kind, @Context HttpHeaders headers) {
        return FileResponses.content(branding.image(slug, kind), headers, CACHE);
    }

    @PUT
    @Path("/images/{kind}")
    @Authenticated
    @Consumes(MediaType.WILDCARD)
    @Operation(
            summary = "Store an image of the branding of an organization",
            description =
                    "Administrators of the organization. kind: logo, logo-dark, icon or favicon; the body is a"
                            + " PNG, JPEG, WebP, ICO or SVG image of up to 2 MB (413 beyond). Replaces the one before. Audited.")
    public BrandingView storeImage(
            @PathParam("slug") String slug, @PathParam("kind") String kind, InputStream content) {
        return branding.storeImage(slug, kind, content == null ? InputStream.nullInputStream() : content);
    }

    @DELETE
    @Path("/images/{kind}")
    @Authenticated
    @Operation(
            summary = "Remove an image of the branding of an organization",
            description = "Administrators of the organization; the shell shows the image of the installation again.")
    public BrandingView removeImage(@PathParam("slug") String slug, @PathParam("kind") String kind) {
        return branding.removeImage(slug, kind);
    }
}
