// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.ResourceReferences;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;

/**
 * Stands for the Java code of an extension that resolves a reference to a resource of another one
 * (MK-135): it calls the {@link ResourceReferences} bean as an extension does, naming itself.
 */
@Path("/api/v1/test/references")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class ReferencesProbe {

    private final ResourceReferences references;

    public ReferencesProbe(ResourceReferences references) {
        this.references = references;
    }

    @GET
    @Path("/{caller}/{extension}/{type}/{id}")
    public Response resolve(
            @PathParam("caller") String caller,
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id) {
        try {
            return Response.ok(references.resolve(caller, new ResourceRef(extension, type, id)))
                    .build();
        } catch (IllegalArgumentException e) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(List.of(String.valueOf(e.getMessage())))
                    .build();
        }
    }
}
