// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import dev.mosaikit.kernel.core.secrets.SecretAdministration.SecretRequest;
import dev.mosaikit.kernel.core.secrets.SecretAdministration.SecretView;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.util.List;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The credentials of the installation (MK-127), kept by platform administrators for the backends of
 * the extensions of every organization. Values go in and never come out: every answer carries a
 * masked hint at most. Answers 503 when the installation has no master key.
 */
@Path("/api/v1/platform/credentials")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@RolesAllowed(Roles.PLATFORM_ADMIN)
@Tag(name = "Platform")
public class InstallationSecretResource {

    private final SecretAdministration administration;
    private final SecurityIdentity identity;

    public InstallationSecretResource(SecretAdministration administration, SecurityIdentity identity) {
        this.administration = administration;
        this.identity = identity;
    }

    @GET
    @Operation(summary = "List the credentials of the installation, without their values")
    public List<SecretView> list() {
        return administration.listInstallation();
    }

    @POST
    @Operation(
            summary = "Store a credential of the installation, encrypted",
            description = "name, kind (password, token, key, other), value, description, and extension when it is"
                    + " meant for one extension only. The answer has a masked hint, never the value.")
    public Response store(SecretRequest request, @Context UriInfo uri) {
        SecretView stored = administration.storeInstallation(request, actor());
        return Response.created(uri.getAbsolutePathBuilder().path(stored.name()).build())
                .entity(stored)
                .build();
    }

    @GET
    @Path("/{name}")
    @Operation(summary = "Get a credential of the installation, without its value")
    public SecretView get(@PathParam("name") String name) {
        return administration.getInstallation(name);
    }

    @PUT
    @Path("/{name}")
    @Operation(
            summary = "Replace a credential of the installation",
            description = "kind, description, extension, and value; without a value the value is kept.")
    public SecretView replace(@PathParam("name") String name, SecretRequest request) {
        return administration.replaceInstallation(name, request, actor());
    }

    @DELETE
    @Path("/{name}")
    @Operation(summary = "Delete a credential of the installation")
    public Response delete(@PathParam("name") String name) {
        administration.deleteInstallation(name, actor());
        return Response.noContent().build();
    }

    private String actor() {
        return identity.getPrincipal().getName();
    }
}
