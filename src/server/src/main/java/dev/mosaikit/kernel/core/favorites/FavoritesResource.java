// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.favorites;

import com.fasterxml.jackson.annotation.JsonInclude;
import dev.mosaikit.kernel.api.resource.ResolvedReference;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.core.account.AccountDirectory;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.resources.ReferenceViews;
import dev.mosaikit.kernel.core.resources.ResourceReferencesResource.Missing;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The favorites of the signed-in person in the organization (MK-094): resources of any extension,
 * in one list, for the shell and for the frontends of extensions.
 */
@Path("/api/v1/favorites")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Favorites")
public class FavoritesResource {

    /**
     * A favorite: {@code status} is {@code available}, with the {@code link} that opens it in its
     * extension, or {@code extension-absent}, with the title it had and, for administrators, what
     * brings the extension back.
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record FavoriteView(
            String extension,
            String type,
            String id,
            String status,
            String title,
            String link,
            Missing missing,
            Instant markedAt) {}

    private final Favorites favorites;
    private final ReferenceViews views;
    private final AccountDirectory accounts;
    private final SecurityIdentity identity;

    public FavoritesResource(
            Favorites favorites, ReferenceViews views, AccountDirectory accounts, SecurityIdentity identity) {
        this.favorites = favorites;
        this.views = views;
        this.accounts = accounts;
        this.identity = identity;
    }

    @GET
    @Operation(
            summary = "List the favorites of the signed-in person in the organization",
            description = "The last marked first. A favorite whose extension is absent shows as extension-absent;"
                    + " one deleted, or that the person may no longer read, is left out.")
    public List<FavoriteView> list() {
        boolean administrator = ReferenceViews.administrator(identity);
        return favorites.list(me()).stream()
                .map(listed -> view(listed, administrator))
                .toList();
    }

    @GET
    @Path("/{extension}/{type}/{id}")
    @Operation(
            summary = "Tell whether a resource is a favorite of the signed-in person",
            description = "404 when it is not, or when it is left out of their list.")
    public FavoriteView get(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        return favorites
                .find(me(), ref(extension, type, id))
                .map(listed -> view(listed, ReferenceViews.administrator(identity)))
                .orElseThrow(() -> new ResourceNotFoundException("It is not one of your favorites."));
    }

    @PUT
    @Path("/{extension}/{type}/{id}")
    @Operation(
            summary = "Mark a resource of an extension as favorite of the signed-in person",
            description = "Only a resource the person may open now; 404 otherwise. Marking it again changes nothing."
                    + " At most 500 favorites.")
    public FavoriteView mark(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        return view(favorites.mark(me(), ref(extension, type, id)), false);
    }

    @DELETE
    @Path("/{extension}/{type}/{id}")
    @Operation(summary = "Remove a resource from the favorites of the signed-in person")
    public Response unmark(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        favorites.unmark(me(), ref(extension, type, id));
        return Response.noContent().build();
    }

    private FavoriteView view(Favorites.Listed listed, boolean administrator) {
        ResolvedReference resolved = listed.resolved();
        ResourceRef target = resolved.target();
        return new FavoriteView(
                target.extension(),
                target.type(),
                target.id(),
                ReferenceViews.status(resolved.availability()),
                listed.title(),
                resolved.resource() == null ? null : resolved.resource().link(),
                views.missing(resolved, administrator),
                listed.markedAt());
    }

    private UUID me() {
        return accounts.idOf(identity.getPrincipal().getName()).orElseThrow();
    }

    private static ResourceRef ref(String extension, String type, String id) {
        try {
            return new ResourceRef(extension, type, id);
        } catch (IllegalArgumentException e) {
            throw new InvalidInputException(List.of("resource " + e.getMessage()));
        }
    }
}
