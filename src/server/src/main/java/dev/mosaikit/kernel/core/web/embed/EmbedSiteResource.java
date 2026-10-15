// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web.embed;

import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.OrganizationService;
import dev.mosaikit.kernel.core.security.Roles;
import dev.mosaikit.kernel.core.web.embed.EmbedSiteAdministration.SiteRequest;
import dev.mosaikit.kernel.core.web.embed.EmbedSiteAdministration.SiteView;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The sites on which an organization lets its views be embedded (MK-100), for the administrators of
 * the organization and for platform administrators. The kernel sends them in {@code frame-ancestors}
 * for the addresses {@code /embed/<slug>/...} only.
 */
@Path("/api/v1/organizations/{slug}/embed-sites")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Organizations")
public class EmbedSiteResource {

    private final EmbedSiteAdministration administration;
    private final EmbedFraming framing;
    private final OrganizationService organizations;
    private final SecurityIdentity identity;

    public EmbedSiteResource(
            EmbedSiteAdministration administration,
            EmbedFraming framing,
            OrganizationService organizations,
            SecurityIdentity identity) {
        this.administration = administration;
        this.framing = framing;
        this.organizations = organizations;
        this.identity = identity;
    }

    @GET
    @Operation(summary = "The sites that may show the views of the organization in an iframe")
    public List<SiteView> list(@PathParam("slug") String slug) {
        return administration.list(managed(slug).getId());
    }

    @POST
    @Operation(
            summary = "Let a site show the views of the organization in an iframe",
            description = "origin: https://host[:port], or http:// for a test site. Sent in frame-ancestors for"
                    + " the addresses /embed/<slug>/... (audited).")
    public Response add(@PathParam("slug") String slug, SiteRequest request) {
        SiteView added = administration.add(
                managed(slug).getId(), request, identity.getPrincipal().getName());
        framing.refresh();
        return Response.status(Response.Status.CREATED).entity(added).build();
    }

    @DELETE
    @Operation(summary = "Stop a site from showing the views of the organization in an iframe (audited)")
    public Response remove(@PathParam("slug") String slug, @QueryParam("origin") String origin) {
        administration.remove(
                managed(slug).getId(), origin, identity.getPrincipal().getName());
        framing.refresh();
        return Response.noContent().build();
    }

    /** The organization, when the person manages it: its administrator, or a platform administrator. */
    private Organization managed(String slug) {
        Organization organization = organizations.require(slug);
        boolean platform = identity.hasRole(Roles.PLATFORM_ADMIN);
        boolean manager = identity.hasRole(Roles.ORGANIZATION_ADMIN)
                && RequestOrganization.of(identity)
                        .filter(organization.getId()::equals)
                        .isPresent();
        if (!platform && !manager) {
            throw new ForbiddenOperationException(
                    "Only the administrators of the organization manage the sites that embed its views.");
        }
        return organization;
    }
}
