// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.favorites;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.resource.ResolvedReference;
import dev.mosaikit.kernel.api.resource.ResolvedReference.Availability;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.sharing.Sharing;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.resources.KernelResourceReferences;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;

/**
 * The favorites of people (MK-094): one list, per person and organization, of the resources of any
 * extension registered with the kernel (MK-054). A person marks only a resource they may open now;
 * the list shows each favorite as the kernel resolves its reference (MK-135) for that person:
 *
 * <ul>
 *   <li>available: with its current title and link, which opens it in its extension;
 *   <li>its extension absent from the organization: a placeholder, with the title it had when it was
 *       marked, until the extension comes back, unless the kernel can tell that the person may no
 *       longer read it;
 *   <li>deleted, or no longer readable by the person: left out of the list.
 * </ul>
 *
 * <p>A favorite left out is kept, not deleted: it comes back when the person is given access again,
 * or when a resource with the same reference is registered again. Nothing is deleted because an
 * extension is absent or misconfigured.
 */
@ApplicationScoped
@Transactional
public class Favorites {

    /** The most favorites of a person in an organization. */
    public static final int MAX_FAVORITES = 500;

    /** A favorite as the person sees it: the resolved reference, its title, and when it was marked. */
    public record Listed(ResolvedReference resolved, String title, Instant markedAt) {}

    private final FavoriteRepository favorites;
    private final Function<ResourceRef, ResolvedReference> references;
    private final Function<ResourceRef, Optional<String>> levels;
    private final CurrentOrganization organization;
    private final Clock clock;

    @Inject
    public Favorites(
            FavoriteRepository favorites,
            KernelResourceReferences references,
            Sharing sharing,
            CurrentOrganization organization) {
        this(favorites, references::resolve, sharing::level, organization, Clock.systemUTC());
    }

    Favorites(
            FavoriteRepository favorites,
            Function<ResourceRef, ResolvedReference> references,
            Function<ResourceRef, Optional<String>> levels,
            CurrentOrganization organization,
            Clock clock) {
        this.favorites = favorites;
        this.references = references;
        this.levels = levels;
        this.organization = organization;
        this.clock = clock;
    }

    /** The favorites of a person in the organization of the request, the last marked first. */
    public List<Listed> list(UUID account) {
        List<Listed> listed = new ArrayList<>();
        for (Favorite favorite : favorites.of(organization.require(), account)) {
            listed(favorite).ifPresent(listed::add);
        }
        return listed;
    }

    /** One favorite of a person, when it is marked and in their list. */
    public Optional<Listed> find(UUID account, ResourceRef ref) {
        return favorite(account, ref).flatMap(this::listed);
    }

    /**
     * Marks a resource as favorite of a person, again when it already is (its title is refreshed).
     *
     * @throws ResourceNotFoundException when the person may not open the resource now: not registered,
     *     extension absent, or no right to read it, without saying which
     * @throws InvalidInputException when the person already has {@value #MAX_FAVORITES} favorites
     */
    public Listed mark(UUID account, ResourceRef ref) {
        ResolvedReference resolved = references.apply(ref);
        if (resolved.availability() != Availability.AVAILABLE) {
            throw new ResourceNotFoundException("There is no resource " + ref + " that you can open.");
        }
        String title = resolved.resource().title();
        Optional<Favorite> existing = favorite(account, ref);
        if (existing.isPresent()) {
            Favorite favorite = existing.get();
            favorite.setTitle(title);
            favorites.update(favorite);
            return new Listed(resolved, title, favorite.getCreatedAt());
        }
        UUID org = organization.require();
        if (favorites.count(org, account) >= MAX_FAVORITES) {
            throw new InvalidInputException(List.of("at most " + MAX_FAVORITES + " favorites"));
        }
        Favorite favorite = new Favorite(org, account, ref, title, Instant.now(clock));
        favorites.insert(favorite);
        return new Listed(resolved, title, favorite.getCreatedAt());
    }

    /** Removes a favorite of a person; nothing happens when it is not one. */
    public void unmark(UUID account, ResourceRef ref) {
        favorite(account, ref).ifPresent(favorites::delete);
    }

    private Optional<Favorite> favorite(UUID account, ResourceRef ref) {
        return favorites.find(organization.require(), account, ref.extension(), ref.type(), ref.id());
    }

    private Optional<Listed> listed(Favorite favorite) {
        ResolvedReference resolved = references.apply(favorite.ref());
        return switch (resolved.availability()) {
            case AVAILABLE ->
                Optional.of(new Listed(resolved, resolved.resource().title(), favorite.getCreatedAt()));
            case EXTENSION_ABSENT ->
                stillReadable(favorite.ref())
                        ? Optional.of(new Listed(resolved, favorite.getTitle(), favorite.getCreatedAt()))
                        : Optional.empty();
            case DELETED, FORBIDDEN -> Optional.empty();
        };
    }

    /**
     * Whether a person may still read a resource whose extension is absent from the organization. When
     * the extension is installed but turned off there, its entries and grants are kept and the kernel
     * can tell; when it is not installed or cannot run, it cannot, and the favorite stays.
     */
    private boolean stillReadable(ResourceRef ref) {
        try {
            return levels.apply(ref).isPresent();
        } catch (IllegalArgumentException notActive) {
            return true;
        }
    }
}
