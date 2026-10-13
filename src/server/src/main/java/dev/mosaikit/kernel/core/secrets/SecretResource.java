// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.OrganizationService;
import dev.mosaikit.kernel.core.secrets.SecretAdministration.SecretRequest;
import dev.mosaikit.kernel.core.secrets.SecretAdministration.SecretView;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
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
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The credentials of an organization (MK-062), kept by its administrators for the backends of its
 * extensions. Values go in and never come out: every answer carries a masked hint at most. Only the
 * administrators of the organization of the request; a platform administrator keeps them only as an
 * administrator of the organization. Answers 503 when the installation has no master key.
 */
@Path("/api/v1/organizations/{slug}/secrets")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Credentials")
public class SecretResource {

    private final SecretAdministration administration;
    private final OrganizationService organizations;
    private final SecurityIdentity identity;

    public SecretResource(
            SecretAdministration administration, OrganizationService organizations, SecurityIdentity identity) {
        this.administration = administration;
        this.organizations = organizations;
        this.identity = identity;
    }

    @GET
    @Operation(summary = "List the credentials of the organization, without their values")
    public List<SecretView> list(@PathParam("slug") String slug) {
        return administration.list(managed(slug));
    }

    @POST
    @Operation(
            summary = "Store a credential, encrypted",
            description = "name, kind (password, token, key, other), value, description, and extension when it is"
                    + " meant for one extension only. The answer has a masked hint, never the value.")
    public Response store(@PathParam("slug") String slug, SecretRequest request, @Context UriInfo uri) {
        SecretView stored = administration.store(managed(slug), request, actor());
        return Response.created(uri.getAbsolutePathBuilder().path(stored.name()).build())
                .entity(stored)
                .build();
    }

    @GET
    @Path("/{name}")
    @Operation(summary = "Get a credential, without its value")
    public SecretView get(@PathParam("slug") String slug, @PathParam("name") String name) {
        return administration.get(managed(slug), name);
    }

    @PUT
    @Path("/{name}")
    @Operation(
            summary = "Replace a credential",
            description = "kind, description, extension, and value; without a value the value is kept.")
    public SecretView replace(@PathParam("slug") String slug, @PathParam("name") String name, SecretRequest request) {
        return administration.replace(managed(slug), name, request, actor());
    }

    @DELETE
    @Path("/{name}")
    @Operation(summary = "Delete a credential")
    public Response delete(@PathParam("slug") String slug, @PathParam("name") String name) {
        administration.delete(managed(slug), name, actor());
        return Response.noContent().build();
    }

    private String actor() {
        return identity.getPrincipal().getName();
    }

    /**
     * The organization, when the person of the request is one of its administrators and acts on it.
     * Row-level security keeps the credentials of an organization to its requests.
     */
    private UUID managed(String slug) {
        Organization organization = organizations.require(slug);
        boolean administrator = identity.hasRole(Roles.ORGANIZATION_ADMIN)
                && RequestOrganization.of(identity)
                        .filter(organization.getId()::equals)
                        .isPresent();
        if (!administrator) {
            throw new ForbiddenOperationException(
                    "Only the administrators of the organization manage its credentials.");
        }
        return organization.getId();
    }
}
