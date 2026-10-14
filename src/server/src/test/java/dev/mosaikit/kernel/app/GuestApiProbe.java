// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.permission.Permissions;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.Resources;
import dev.mosaikit.kernel.api.sharing.Sharing;
import io.quarkus.security.Authenticated;
import jakarta.annotation.security.RolesAllowed;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;
import java.util.TreeSet;

/**
 * Stands for the Java backend of an extension ({@value GuestExtensionApiTest#API}) that guests of an
 * organization may reach (MK-032): it checks permissions and sharing as the guide asks, and keeps one
 * route to the members of the organization with their roles.
 */
@Path("/api/v1/ext/" + GuestExtensionApiTest.API)
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class GuestApiProbe {

    private static final String EXTENSION = GuestExtensionApiTest.EXTENSION;

    private final Sharing sharing;
    private final Permissions permissions;
    private final Resources resources;

    public GuestApiProbe(Sharing sharing, Permissions permissions, Resources resources) {
        this.sharing = sharing;
        this.permissions = permissions;
        this.resources = resources;
    }

    private static ResourceRef item(String id) {
        return new ResourceRef(EXTENSION, "item", id);
    }

    /** The items the person sees. */
    @GET
    @Path("items")
    public TreeSet<String> list() {
        return new TreeSet<>(sharing.visible(EXTENSION, "item", "view"));
    }

    /** One item, with the level of the person. */
    @GET
    @Path("items/{id}")
    public Map<String, String> get(@PathParam("id") String id) {
        sharing.require(item(id), "view");
        return Map.of("id", id, "level", sharing.level(item(id)).orElse(""));
    }

    /** Changes an item: who may edit it. */
    @PUT
    @Path("items/{id}")
    public Response change(@PathParam("id") String id) {
        sharing.require(item(id), "edit");
        return Response.noContent().build();
    }

    /** Creates an item: who holds {@code create-item}. */
    @POST
    @Path("items/{id}")
    @Transactional
    public Response create(@PathParam("id") String id) {
        permissions.require(EXTENSION, "create-item");
        resources.register(item(id), Resources.Details.of("Item " + id, "/app/guest-probe/" + id));
        return Response.status(Response.Status.CREATED).build();
    }

    /** A route for the people of the organization only, whatever a guest was given. */
    @GET
    @Path("members-only")
    @RolesAllowed({"organization-user", "organization-admin"})
    public Map<String, Boolean> membersOnly() {
        return Map.of("member", true);
    }
}
