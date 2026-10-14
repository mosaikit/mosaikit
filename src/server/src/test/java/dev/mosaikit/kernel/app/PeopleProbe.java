// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.teams.People;
import dev.mosaikit.kernel.api.teams.Teams;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.UUID;

/**
 * Stands for the Java backend of an extension that names the people and teams of the organization in
 * the rules of another server (MK-032, MK-123): it calls the {@link People} bean as an extension does.
 */
@Path("/api/v1/test/people")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class PeopleProbe {

    private final People people;

    public PeopleProbe(People people) {
        this.people = people;
    }

    @GET
    public List<People.Person> list() {
        return people.list();
    }

    @GET
    @Path("/by-username/{username}")
    public Response byUsername(@PathParam("username") String username) {
        return people.findByUsername(username)
                .map(person -> Response.ok(person).build())
                .orElse(Response.status(Response.Status.NOT_FOUND).build());
    }

    @GET
    @Path("/accounts/{account}")
    public Response find(@PathParam("account") UUID account) {
        return people.find(account)
                .map(person -> Response.ok(person).build())
                .orElse(Response.status(Response.Status.NOT_FOUND).build());
    }

    @GET
    @Path("/teams")
    public List<People.OrganizationTeam> teams() {
        return people.teams();
    }

    @GET
    @Path("/teams/{team}/members")
    public List<Teams.Member> members(@PathParam("team") UUID team) {
        return people.members(team);
    }

    @GET
    @Path("/accounts/{account}/teams")
    public List<People.OrganizationTeam> teamsOf(@PathParam("account") UUID account) {
        return people.teamsOf(account);
    }
}
