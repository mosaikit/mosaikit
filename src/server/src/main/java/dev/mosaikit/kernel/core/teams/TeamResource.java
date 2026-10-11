// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.teams;

import dev.mosaikit.kernel.core.teams.TeamService.TeamRequest;
import dev.mosaikit.kernel.core.teams.TeamService.TeamView;
import io.quarkus.security.Authenticated;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.util.List;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/** The teams of the organization of the request (MK-032). */
@Path("/api/v1/teams")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Teams")
public class TeamResource {

    /** The role of a person in a team. */
    public record RoleRequest(@NotNull String role) {}

    private final TeamService teams;

    public TeamResource(TeamService teams) {
        this.teams = teams;
    }

    @GET
    @Operation(
            summary = "List the teams that the signed-in person sees: theirs and the public ones",
            description = "With ?parent=<id>, the groups of that team in which the person is (MK-034); with"
                    + " ?kind=chat, the chats of the person, newest first (MK-036).")
    public List<TeamView> list(@QueryParam("parent") UUID parent, @QueryParam("kind") String kind) {
        if ("chat".equals(kind)) {
            return teams.chats();
        }
        return parent == null ? teams.list() : teams.groups(parent);
    }

    @POST
    @Operation(summary = "Create a team, whose owner is the signed-in person")
    public Response create(TeamRequest request, @Context UriInfo uri) {
        TeamView created = teams.create(request);
        return Response.created(uri.getAbsolutePathBuilder()
                        .path(created.id().toString())
                        .build())
                .entity(created)
                .build();
    }

    @GET
    @Path("/{id}")
    @Operation(summary = "Get a team with its people")
    public TeamView get(@PathParam("id") UUID id) {
        return teams.get(id);
    }

    @PUT
    @Path("/{id}")
    @Operation(summary = "Change the name, description or visibility of a team")
    public TeamView change(@PathParam("id") UUID id, TeamRequest request) {
        return teams.change(id, request);
    }

    @DELETE
    @Path("/{id}")
    @Operation(summary = "Delete a team, with the documents shared with it")
    public Response delete(@PathParam("id") UUID id) {
        teams.delete(id);
        return Response.noContent().build();
    }

    @PUT
    @Path("/{id}/members/{email}")
    @Operation(
            summary = "Add a person to a team, or change their role",
            description = "owner or member for people of the organization, guest for a person of another one.")
    public TeamView putMember(@PathParam("id") UUID id, @PathParam("email") String email, RoleRequest request) {
        return teams.putMember(id, email, request == null ? null : request.role());
    }

    @DELETE
    @Path("/{id}/members/{email}")
    @Operation(summary = "Remove a person from a team, or leave it")
    public Response removeMember(@PathParam("id") UUID id, @PathParam("email") String email) {
        teams.removeMember(id, email);
        return Response.noContent().build();
    }
}
