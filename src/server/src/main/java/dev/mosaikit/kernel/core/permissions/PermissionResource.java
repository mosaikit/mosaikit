// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.permissions;

import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.OrganizationService;
import dev.mosaikit.kernel.core.permissions.PermissionAdministration.Assignment;
import dev.mosaikit.kernel.core.permissions.PermissionAdministration.DeclaredView;
import dev.mosaikit.kernel.core.permissions.PermissionAdministration.MemberView;
import dev.mosaikit.kernel.core.permissions.PermissionAdministration.PreviewRequest;
import dev.mosaikit.kernel.core.permissions.PermissionAdministration.PreviewView;
import dev.mosaikit.kernel.core.permissions.PermissionAdministration.ProfileRequest;
import dev.mosaikit.kernel.core.permissions.PermissionAdministration.ProfileView;
import dev.mosaikit.kernel.core.permissions.PermissionAdministration.TeamView;
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
 * The permissions of an organization (MK-056, ADR-0038), managed by its administrators: the
 * permissions the active extensions declare, the profiles, the profile of each member, the grants to
 * teams and the personal exceptions, and what a person holds and why. Only the administrators of the
 * organization of the request; a platform administrator manages them only as an administrator of
 * the organization.
 */
@Path("/api/v1/organizations/{slug}/permissions")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Permissions")
public class PermissionResource {

    private final PermissionAdministration administration;
    private final OrganizationService organizations;
    private final SecurityIdentity identity;

    public PermissionResource(
            PermissionAdministration administration, OrganizationService organizations, SecurityIdentity identity) {
        this.administration = administration;
        this.organizations = organizations;
        this.identity = identity;
    }

    @GET
    @Operation(
            summary = "List the permissions that the active extensions declare",
            description = "Qualified identifier <extension>:<permission>, extension, title and description from"
                    + " the manifest; off is true when all the apps of the extension are off for the organization.")
    public List<DeclaredView> declared(@PathParam("slug") String slug) {
        return administration.declared(managed(slug));
    }

    @GET
    @Path("/profiles")
    @Operation(summary = "List the profiles of the organization with their permissions")
    public List<ProfileView> profiles(@PathParam("slug") String slug) {
        return administration.profiles(managed(slug));
    }

    @POST
    @Path("/profiles")
    @Operation(
            summary = "Create a profile",
            description = "defaultForRole: organization-user makes it the profile of the members without one.")
    public Response createProfile(@PathParam("slug") String slug, ProfileRequest request, @Context UriInfo uri) {
        ProfileView created = administration.createProfile(managed(slug), request);
        return Response.created(uri.getAbsolutePathBuilder()
                        .path(created.id().toString())
                        .build())
                .entity(created)
                .build();
    }

    @GET
    @Path("/profiles/{id}")
    @Operation(summary = "Get a profile with its permissions")
    public ProfileView profile(@PathParam("slug") String slug, @PathParam("id") UUID id) {
        return administration.profile(managed(slug), id);
    }

    @PUT
    @Path("/profiles/{id}")
    @Operation(summary = "Change a profile: name, description, default role and the whole set of its permissions")
    public ProfileView changeProfile(@PathParam("slug") String slug, @PathParam("id") UUID id, ProfileRequest request) {
        return administration.changeProfile(managed(slug), id, request);
    }

    @DELETE
    @Path("/profiles/{id}")
    @Operation(summary = "Delete a profile; its members go back to the default profile of their role")
    public Response deleteProfile(@PathParam("slug") String slug, @PathParam("id") UUID id) {
        administration.deleteProfile(managed(slug), id);
        return Response.noContent().build();
    }

    @GET
    @Path("/members/{email}")
    @Operation(
            summary = "Get the permissions of a member and where each comes from",
            description = "Sources: administrator, profile, team, exception. A permission of an extension whose"
                    + " apps are all off is listed with granted false and withheld apps-off.")
    public MemberView member(@PathParam("slug") String slug, @PathParam("email") String email) {
        return administration.member(managed(slug), email);
    }

    @PUT
    @Path("/members/{email}/profile")
    @Operation(summary = "Assign a profile to a member; a null profile gives back the default of the role")
    public MemberView assign(@PathParam("slug") String slug, @PathParam("email") String email, Assignment request) {
        return administration.assign(managed(slug), email, request == null ? null : request.profile());
    }

    @PUT
    @Path("/members/{email}/exceptions/{permission}")
    @Operation(summary = "Grant a permission to a member as a personal exception")
    public MemberView grantException(
            @PathParam("slug") String slug,
            @PathParam("email") String email,
            @PathParam("permission") String permission) {
        return administration.grantException(managed(slug), email, permission);
    }

    @DELETE
    @Path("/members/{email}/exceptions/{permission}")
    @Operation(summary = "Revoke a personal exception of a member")
    public MemberView revokeException(
            @PathParam("slug") String slug,
            @PathParam("email") String email,
            @PathParam("permission") String permission) {
        return administration.revokeException(managed(slug), email, permission);
    }

    @GET
    @Path("/teams/{id}")
    @Operation(summary = "Get the permissions granted to a team")
    public TeamView team(@PathParam("slug") String slug, @PathParam("id") UUID id) {
        return administration.team(managed(slug), id);
    }

    @PUT
    @Path("/teams/{id}/{permission}")
    @Operation(summary = "Grant a permission to a team, for its members and guests")
    public TeamView grantTeam(
            @PathParam("slug") String slug, @PathParam("id") UUID id, @PathParam("permission") String permission) {
        return administration.grantTeam(managed(slug), id, permission);
    }

    @DELETE
    @Path("/teams/{id}/{permission}")
    @Operation(summary = "Revoke a permission granted to a team")
    public TeamView revokeTeam(
            @PathParam("slug") String slug, @PathParam("id") UUID id, @PathParam("permission") String permission) {
        return administration.revokeTeam(managed(slug), id, permission);
    }

    @POST
    @Path("/preview")
    @Operation(
            summary = "Preview the permissions of a proposed member, without changing anything",
            description = "For an invitation: role (organization-admin, organization-user or organization-guest),"
                    + " profile (the default of the role when null) and teams.")
    public PreviewView preview(@PathParam("slug") String slug, PreviewRequest request) {
        return administration.preview(managed(slug), request);
    }

    /**
     * The organization, when the person of the request is one of its administrators and acts on it.
     * Row-level security keeps the permissions of an organization to its requests, so a platform
     * administrator manages them only as an administrator of the organization.
     */
    private UUID managed(String slug) {
        Organization organization = organizations.require(slug);
        boolean administrator = identity.hasRole(Roles.ORGANIZATION_ADMIN)
                && RequestOrganization.of(identity)
                        .filter(organization.getId()::equals)
                        .isPresent();
        if (!administrator) {
            throw new ForbiddenOperationException(
                    "Only the administrators of the organization manage its permissions.");
        }
        return organization.getId();
    }
}
