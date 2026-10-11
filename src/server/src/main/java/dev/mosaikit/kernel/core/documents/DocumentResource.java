// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.documents;

import com.fasterxml.jackson.databind.JsonNode;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.DefaultValue;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.util.List;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The collections of documents of plugins without a backend (ADR-0031, MK-046), in the organization
 * of the request: {@code /api/v1/data/<plugin id>/<collection>}.
 */
@Path("/api/v1/data/{plugin}/{collection}")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Plugin data")
public class DocumentResource {

    private final DocumentService documents;

    public DocumentResource(DocumentService documents) {
        this.documents = documents;
    }

    @GET
    @Operation(
            summary = "List the documents of a collection, newest first",
            description = "Those of the whole organization, or, with ?team=<id>, those shared with that team.")
    public List<DocumentView> list(
            @PathParam("plugin") String plugin,
            @PathParam("collection") String collection,
            @QueryParam("team") UUID team,
            @QueryParam("offset") @DefaultValue("0") int offset,
            @QueryParam("limit") @DefaultValue("100") int limit) {
        return documents.list(plugin, collection, team, offset, limit);
    }

    @POST
    @Operation(
            summary = "Add a document to a collection",
            description = "With ?team=<id>, shared with that team of the person only (MK-032).")
    public Response create(
            @PathParam("plugin") String plugin,
            @PathParam("collection") String collection,
            @QueryParam("team") UUID team,
            JsonNode data,
            @jakarta.ws.rs.core.Context UriInfo uri) {
        DocumentView created = documents.create(plugin, collection, team, data);
        return Response.created(uri.getAbsolutePathBuilder()
                        .path(created.id().toString())
                        .build())
                .entity(created)
                .build();
    }

    @GET
    @Path("/{id}")
    @Operation(summary = "Get a document")
    public DocumentView get(
            @PathParam("plugin") String plugin, @PathParam("collection") String collection, @PathParam("id") UUID id) {
        return documents.get(plugin, collection, id);
    }

    @PUT
    @Path("/{id}")
    @Operation(
            summary = "Replace a document",
            description = "With If-Match: <version>, refused with 409 if the document changed since.")
    public DocumentView replace(
            @PathParam("plugin") String plugin,
            @PathParam("collection") String collection,
            @PathParam("id") UUID id,
            @HeaderParam("If-Match") String ifMatch,
            JsonNode data) {
        return documents.replace(plugin, collection, id, data, version(ifMatch));
    }

    @DELETE
    @Path("/{id}")
    @Operation(summary = "Delete a document")
    public Response delete(
            @PathParam("plugin") String plugin, @PathParam("collection") String collection, @PathParam("id") UUID id) {
        documents.delete(plugin, collection, id);
        return Response.noContent().build();
    }

    private static Integer version(String ifMatch) {
        if (ifMatch == null || ifMatch.isBlank() || ifMatch.equals("*")) {
            return null;
        }
        try {
            return Integer.valueOf(ifMatch.replace("\"", "").strip());
        } catch (NumberFormatException e) {
            throw new InvalidInputException(List.of("If-Match must be the version of the document"));
        }
    }
}
