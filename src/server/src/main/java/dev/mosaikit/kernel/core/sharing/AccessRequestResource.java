// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.sharing.AccessRequestService.OwnRequest;
import dev.mosaikit.kernel.core.sharing.AccessRequestService.PendingRequest;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * Requests for access (MK-058): a person refused a resource asks for a level on it from the page that
 * refused them; the people who may share the resource decide from one list.
 */
@Path("/api/v1/access-requests")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Sharing")
public class AccessRequestResource {

    /**
     * A request: the resource as the refused page names it, the level asked (the lowest of the type
     * when absent) and a message.
     */
    public record RequestBody(String extension, String type, String id, String level, String message) {}

    /** A decision: the level to grant in place of the one asked, or the reason of a rejection. */
    public record DecisionBody(String level, String reason) {}

    private final AccessRequestService requests;

    public AccessRequestResource(AccessRequestService requests) {
        this.requests = requests;
    }

    @POST
    @Operation(
            summary = "Ask for access to a resource refused to the signed-in person",
            description = "202 with the request, the same whether the resource exists or not; the people who may"
                    + " share it are notified. Asking again while pending replaces the message.")
    public Response request(RequestBody body) {
        if (body == null) {
            throw new InvalidInputException(List.of("extension, type and id are required"));
        }
        ResourceRef ref;
        try {
            ref = new ResourceRef(body.extension(), body.type(), body.id());
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new InvalidInputException(List.of("resource " + e.getMessage()));
        }
        OwnRequest sent = requests.request(ref, body.level(), body.message());
        return Response.status(Response.Status.ACCEPTED).entity(sent).build();
    }

    @GET
    @Operation(
            summary = "List the pending requests for access the signed-in person may decide",
            description =
                    "Those for the resources they may share (owner, administrators, highest level), oldest" + " first.")
    public List<PendingRequest> toDecide() {
        return requests.toDecide();
    }

    @GET
    @Path("/mine")
    @Operation(summary = "List the requests for access of the signed-in person, newest first, with their outcome")
    public List<OwnRequest> mine() {
        return requests.mine();
    }

    @POST
    @Path("/{id}/approve")
    @Operation(
            summary = "Approve a request for access: grant the level asked, or the one given",
            description = "With the sharing model, as the signed-in person; the requester is notified. 404 for a"
                    + " request they may not decide.")
    public OwnRequest approve(@PathParam("id") UUID id, DecisionBody body) {
        return requests.approve(id, body == null ? null : body.level());
    }

    @POST
    @Path("/{id}/reject")
    @Operation(
            summary = "Reject a request for access, with an optional reason",
            description = "The requester is notified. 404 for a request the signed-in person may not decide.")
    public OwnRequest reject(@PathParam("id") UUID id, DecisionBody body) {
        return requests.reject(id, body == null ? null : body.reason());
    }

    @DELETE
    @Path("/{id}")
    @Operation(summary = "Withdraw a pending request for access of the signed-in person")
    public Response withdraw(@PathParam("id") UUID id) {
        requests.withdraw(id);
        return Response.noContent().build();
    }
}
