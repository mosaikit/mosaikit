// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.resources;

import io.quarkus.security.Authenticated;
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
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The trash of the signed-in person (MK-095): the resources they own that went to the trash, and for
 * the administrators of the organization those of everyone; restoring one brings it back with its
 * grants, deleting one removes it for good.
 */
@Path("/api/v1/trash")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Trash")
public class TrashResource {

    private final KernelTrash trash;

    public TrashResource(KernelTrash trash) {
        this.trash = trash;
    }

    @GET
    @Operation(
            summary = "List the trash of the signed-in person in the organization, the most recently trashed first",
            description = "The resources they own that were trashed; with scope=organization, for its"
                    + " administrators, those of everyone. The resources that went with one are counted in"
                    + " contents.")
    public List<KernelTrash.Trashed> list(@QueryParam("scope") String scope) {
        return trash.list("organization".equals(scope));
    }

    @POST
    @Path("/{id}/restore")
    @Operation(
            summary = "Restore a resource of the trash, with what went with it and its grants",
            description = "Its owner or an administrator of the organization; 409 when the resource that"
                    + " contains it is in the trash.")
    public Map<String, Object> restore(@PathParam("id") UUID id) {
        return Map.of("restored", trash.restoreFromPage(id).size());
    }

    @DELETE
    @Path("/{id}")
    @Operation(
            summary = "Delete a resource of the trash for good, with what went with it",
            description =
                    "Its owner or an administrator of the organization; its extension is told to delete its data.")
    public Response purge(@PathParam("id") UUID id) {
        trash.purgeFromPage(id);
        return Response.noContent().build();
    }
}
