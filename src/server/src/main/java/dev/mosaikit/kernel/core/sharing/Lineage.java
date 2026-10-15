// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.core.resources.RegisteredResource;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Predicate;

/**
 * Some resources, the resources above them whose levels reach them, and the grants of all of them,
 * read at once (MK-136): the levels of a viewer, from their own and from those they hold above, as
 * {@code mk_kernel.allows()} gives them in the database. A resource of a type that declares
 * {@code inherits: parent} gets the levels of its parent, and so on upwards while the types on the way
 * inherit too; any other resource has only its own.
 */
final class Lineage {

    /** How far up the parents are followed, as {@code mk_kernel.lineage()} does. */
    static final int MAX_DEPTH = 100;

    private final Map<UUID, RegisteredResource> entries;
    private final Map<UUID, List<ResourceGrant>> grants;
    private final Function<ResourceRef, Optional<ResourceTypeEntry>> types;
    private final Map<String, Optional<ResourceTypeEntry>> known = new HashMap<>();

    /**
     * @param entries the resources and those above them, by id; those above that are missing end the
     *     chain
     * @param grants the grants of those resources, revoked links included
     * @param types the type of a resource, empty when no active extension declares it
     */
    Lineage(
            Collection<RegisteredResource> entries,
            Collection<ResourceGrant> grants,
            Function<ResourceRef, Optional<ResourceTypeEntry>> types) {
        this.entries = new HashMap<>();
        entries.forEach(entry -> this.entries.put(entry.getId(), entry));
        this.grants = new HashMap<>();
        grants.forEach(grant -> this.grants
                .computeIfAbsent(grant.getResourceId(), _ -> new ArrayList<>())
                .add(grant));
        this.types = types;
    }

    /** The type of a resource, as its extension declares it now. */
    Optional<ResourceTypeEntry> type(RegisteredResource entry) {
        return known.computeIfAbsent(
                entry.getExtensionId() + "\n" + entry.getResourceType(), _ -> types.apply(entry.ref()));
    }

    /** The grants of a resource itself, revoked links included. */
    List<ResourceGrant> grantsOf(RegisteredResource entry) {
        return grants.getOrDefault(entry.getId(), List.of());
    }

    /**
     * The resources above a resource whose levels reach it, from its parent upwards: the parent of a
     * resource of a type that inherits, then its parent while its type inherits too. Empty for a type
     * that does not inherit.
     */
    List<RegisteredResource> above(RegisteredResource entry) {
        List<RegisteredResource> above = new ArrayList<>();
        Set<UUID> seen = new HashSet<>();
        seen.add(entry.getId());
        RegisteredResource step = entry;
        while (above.size() < MAX_DEPTH
                && step.getParentId() != null
                && type(step).filter(ResourceTypeEntry::inheritsFromParent).isPresent()) {
            RegisteredResource parent = entries.get(step.getParentId());
            if (parent == null || !seen.add(parent.getId()) || type(parent).isEmpty()) {
                break;
            }
            above.add(parent);
            step = parent;
        }
        return above;
    }

    /**
     * The highest level of a viewer on a resource: their own, or what a level of theirs on a resource
     * above counts for on it ({@link ResourceTypeEntry#carried}); empty when they have none.
     *
     * @param counted the grants that count, such as those that are not links nor to the public
     */
    Optional<String> level(
            ResourceTypeEntry type,
            RegisteredResource entry,
            Reach.Viewer viewer,
            Predicate<ResourceGrant> counted,
            Instant now) {
        if (entry.inTrash()) {
            // A resource in the trash gives no level to anyone until it is restored (MK-095).
            return Optional.empty();
        }
        List<String> names = type.levelNames();
        int best = Reach.level(type, entry.getOwnerId(), viewer, counted(entry, counted), now)
                .map(names::indexOf)
                .orElse(-1);
        for (RegisteredResource parent : above(entry)) {
            if (best == names.size() - 1) {
                break;
            }
            ResourceTypeEntry parentType = type(parent).orElseThrow();
            int carried = Reach.level(parentType, parent.getOwnerId(), viewer, counted(parent, counted), now)
                    .flatMap(held -> type.carried(parentType, held))
                    .map(names::indexOf)
                    .orElse(-1);
            best = Math.max(best, carried);
        }
        return best < 0 ? Optional.empty() : Optional.of(names.get(best));
    }

    private List<ResourceGrant> counted(RegisteredResource entry, Predicate<ResourceGrant> counted) {
        return grantsOf(entry).stream().filter(counted).toList();
    }
}
