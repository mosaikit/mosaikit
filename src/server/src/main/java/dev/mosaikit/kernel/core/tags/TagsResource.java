// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.tags;

import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.permission.AccessDeniedException;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.Tags;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.sharing.KernelSharing;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DefaultValue;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import java.util.HashSet;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.function.Supplier;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * Free tags on the resources of extensions (MK-097), for the frontends of extensions: the same tags,
 * gesture and suggestions for every resource type. A person sees the tags of a resource only when they
 * may read it, and changes them when they may edit it.
 */
@Path("/api/v1/resources/tags")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Resources")
public class TagsResource {

    private final Tags tags;
    private final KernelSharing sharing;

    public TagsResource(Tags tags, KernelSharing sharing) {
        this.tags = tags;
        this.sharing = sharing;
    }

    @GET
    @Path("/suggestions")
    @Operation(
            summary = "Suggest tags while a person types",
            description = "The tags used in the organization that start with prefix, on resources of any extension"
                    + " the person may read: the most used first. At most 50.")
    public List<String> suggest(
            @QueryParam("prefix") @DefaultValue("") String prefix, @QueryParam("limit") @DefaultValue("10") int limit) {
        return tags.suggest(prefix, limit);
    }

    @GET
    @Path("/{extension}/{type}")
    @Operation(
            summary = "Find the resources of a type that carry any of some tags",
            description = "The identifiers of the resources of the type that carry any of the tags (repeat tag) and"
                    + " that the person may read, for a list filtered by tags.")
    public Set<String> tagged(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @QueryParam("tag") List<String> wanted) {
        return call(() -> {
            ResourceTypeEntry entry = sharing.typeOf(new ResourceRef(extension, type, "-"));
            Set<String> found = new HashSet<>(tags.tagged(extension, type, wanted == null ? List.of() : wanted));
            if (!found.isEmpty()) {
                found.retainAll(
                        sharing.visible(extension, type, entry.levelNames().getFirst()));
            }
            return Set.copyOf(found);
        });
    }

    @GET
    @Path("/{extension}/{type}/{id}")
    @Operation(
            summary = "Read the tags of a resource",
            description = "The tags of a resource the person may read, in alphabetical order.")
    public List<String> of(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        return call(() -> {
            ResourceRef ref = new ResourceRef(extension, type, id);
            if (sharing.level(ref).isEmpty()) {
                throw new AccessDeniedException("No level on " + ref + ".", true);
            }
            return tags.of(ref);
        });
    }

    @PUT
    @Path("/{extension}/{type}/{id}")
    @Operation(
            summary = "Replace the tags of a resource",
            description = "Replaces the tags of a resource the person may edit with those of the body, stored in"
                    + " lowercase without duplicates; an empty list removes them. Answers the tags.")
    public List<String> replace(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id,
            List<String> replaced) {
        if (replaced == null) {
            throw new InvalidInputException(List.of("a list of tags is required"));
        }
        return call(() -> {
            ResourceRef ref = new ResourceRef(extension, type, id);
            if (!sharing.mayEdit(ref)) {
                boolean seen = sharing.level(ref).isPresent();
                throw new AccessDeniedException("You may not change the tags of " + ref + ".", !seen);
            }
            return tags.replace(ref, replaced);
        });
    }

    /** The errors of the extension API as problems of the REST API. */
    private static <T> T call(Supplier<T> action) {
        try {
            return action.get();
        } catch (NoSuchElementException e) {
            throw new ResourceNotFoundException(e.getMessage());
        } catch (IllegalArgumentException e) {
            throw new InvalidInputException(List.of(String.valueOf(e.getMessage())));
        }
    }
}
