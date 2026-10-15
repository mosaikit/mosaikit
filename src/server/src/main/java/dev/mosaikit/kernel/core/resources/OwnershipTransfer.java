// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.resources;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.resource.OwnershipTransfers;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Any;
import jakarta.enterprise.inject.Instance;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The resources a member owns, and their transfer to another member when the first leaves the
 * organization (MK-071): the registry gives them to the new owner, their grants untouched, and each
 * extension that owns some of them follows through {@link OwnershipTransfers}.
 *
 * <p>The callers check who acts and who the members are; every query names the organization, since a
 * platform administrator acts on no organization and row-level security then shows every row.
 */
@ApplicationScoped
@Transactional
public class OwnershipTransfer {

    /**
     * A resource a member owns, as the removal shows it.
     *
     * @param type the resource type
     * @param typeTitle its title in the manifest
     * @param id the identifier in the extension
     * @param title the title in the registry
     * @param link where it opens
     * @param trashed whether it is in the trash
     */
    public record OwnedResource(String type, String typeTitle, String id, String title, String link, boolean trashed) {}

    /**
     * The resources of one extension that a member owns.
     *
     * @param extension the extension
     * @param extensionName its name, or its identifier when it is no longer installed
     * @param resources the resources, by type and title
     */
    public record OwnedByExtension(String extension, String extensionName, List<OwnedResource> resources) {}

    private final RegisteredResources entries;
    private final EntityManager entityManager;
    private final ExtensionRegistry extensions;
    private final Instance<OwnershipTransfers> handlers;
    private final Clock clock;

    public OwnershipTransfer(
            RegisteredResources entries,
            EntityManager entityManager,
            ExtensionRegistry extensions,
            @Any Instance<OwnershipTransfers> handlers,
            Clock clock) {
        this.entries = entries;
        this.entityManager = entityManager;
        this.extensions = extensions;
        this.handlers = handlers;
        this.clock = clock;
    }

    /** The resources a person owns in an organization, grouped by extension. */
    public List<OwnedByExtension> owned(UUID organization, UUID owner) {
        Map<String, List<RegisteredResource>> byExtension = entries.ownedBy(organization, owner).stream()
                .collect(Collectors.groupingBy(
                        RegisteredResource::getExtensionId, LinkedHashMap::new, Collectors.toList()));
        List<OwnedByExtension> owned = new ArrayList<>();
        byExtension.forEach((extension, found) -> {
            Optional<ExtensionManifest> manifest = extensions.all().stream()
                    .filter(installed -> installed.key().equals(extension))
                    .findFirst()
                    .flatMap(InstalledExtension::manifest);
            owned.add(new OwnedByExtension(
                    extension,
                    manifest.map(ExtensionManifest::name).orElse(extension),
                    found.stream()
                            .map(entry -> new OwnedResource(
                                    entry.getResourceType(),
                                    manifest.flatMap(m -> m.resourceType(entry.getResourceType()))
                                            .map(ResourceTypeEntry::title)
                                            .orElse(entry.getResourceType()),
                                    entry.getRefId(),
                                    entry.getTitle(),
                                    entry.getLink(),
                                    entry.inTrash()))
                            .toList()));
        });
        return owned;
    }

    /**
     * Gives every resource a person owns in an organization to another person, with its grants as they
     * were, and tells each active extension that owns some of them.
     *
     * @return the resources transferred, by extension
     * @throws RuntimeException what an extension threw: the transaction then rolls back
     */
    public Map<String, List<ResourceRef>> transfer(UUID organization, UUID from, UUID to) {
        Map<String, List<ResourceRef>> moved = entries.ownedBy(organization, from).stream()
                .collect(Collectors.groupingBy(
                        RegisteredResource::getExtensionId,
                        LinkedHashMap::new,
                        Collectors.mapping(RegisteredResource::ref, Collectors.toList())));
        if (moved.isEmpty()) {
            return moved;
        }
        entityManager
                .createNativeQuery("update {h-schema}resource set owner_id = :to, updated_at = :now"
                        + " where organization_id = :org and owner_id = :from")
                .setParameter("to", to)
                .setParameter("now", Timestamp.from(Instant.now(clock)))
                .setParameter("org", organization)
                .setParameter("from", from)
                .executeUpdate();
        for (OwnershipTransfers handler : handlers) {
            List<ResourceRef> refs = moved.get(handler.extension());
            if (refs != null && extensions.findActive(handler.extension()).isPresent()) {
                handler.transferred(new OwnershipTransfers.Transfer(organization, from, to, refs));
            }
        }
        return moved;
    }
}
