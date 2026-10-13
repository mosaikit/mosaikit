// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.resources;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.resource.Resource;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.Resources;
import dev.mosaikit.kernel.core.events.PlatformEventLog;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.ExtensionsLoaded;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Supplier;
import java.util.stream.Collectors;
import org.jboss.logging.Logger;

/**
 * The registry of the resources of extensions (MK-054, ADR-0037), the kernel's {@link Resources}
 * bean. Every call acts on the organization of the request and joins the transaction of the caller.
 * The calling extension names itself in the reference; only an active extension that declares the
 * type in {@code resources} of its manifest registers, reads and removes entries of that type.
 */
@ApplicationScoped
@Transactional
public class ResourceRegistry implements Resources {

    private static final Logger LOG = Logger.getLogger(ResourceRegistry.class);

    /** How far up the parents are followed to refuse a resource that would contain itself. */
    static final int MAX_DEPTH = 100;

    private final RegisteredResources entries;
    private final Function<String, Optional<ExtensionManifest>> manifests;
    private final Supplier<Collection<String>> installed;
    private final CurrentOrganization organization;
    private final Supplier<Optional<UUID>> person;
    private final Clock clock;
    private final Raise raise;

    /** Raises an event of the platform in an organization (MK-085). */
    @FunctionalInterface
    interface Raise {
        void raise(UUID organization, String type, Map<String, ?> payload);
    }

    @Inject
    public ResourceRegistry(
            RegisteredResources entries,
            ExtensionRegistry extensions,
            CurrentOrganization organization,
            SecurityIdentity identity,
            PlatformEventLog events) {
        this(
                entries,
                id -> extensions.findActive(id).flatMap(InstalledExtension::manifest),
                () -> extensions.all().stream().map(InstalledExtension::key).toList(),
                organization,
                () -> RequestOrganization.account(identity),
                Clock.systemUTC(),
                events::raise);
    }

    ResourceRegistry(
            RegisteredResources entries,
            Function<String, Optional<ExtensionManifest>> manifests,
            Supplier<Collection<String>> installed,
            CurrentOrganization organization,
            Supplier<Optional<UUID>> person,
            Clock clock) {
        this(entries, manifests, installed, organization, person, clock, (org, type, payload) -> {});
    }

    ResourceRegistry(
            RegisteredResources entries,
            Function<String, Optional<ExtensionManifest>> manifests,
            Supplier<Collection<String>> installed,
            CurrentOrganization organization,
            Supplier<Optional<UUID>> person,
            Clock clock,
            Raise raise) {
        this.entries = entries;
        this.manifests = manifests;
        this.installed = installed;
        this.organization = organization;
        this.person = person;
        this.clock = clock;
        this.raise = raise;
    }

    @Override
    public Resource register(ResourceRef ref, Details details) {
        Objects.requireNonNull(details, "details");
        declared(ref);
        UUID org = organization.require();
        Optional<RegisteredResource> existing = entries.find(org, ref.extension(), ref.type(), ref.id());
        UUID parent = parent(org, ref, existing.map(RegisteredResource::getId), details.parent());
        Instant now = Instant.now(clock);
        if (existing.isPresent()) {
            RegisteredResource entry = existing.get();
            entry.change(details.title(), details.link(), parent, now);
            entries.update(entry);
            return view(entry, details.parent());
        }
        RegisteredResource entry = new RegisteredResource(
                org, ref, person.get().orElse(null), details.title(), details.link(), parent, now);
        entries.insert(entry);
        Map<String, Object> payload = new LinkedHashMap<>(refPayload(ref));
        payload.put("title", entry.getTitle());
        if (entry.getOwnerId() != null) {
            payload.put("owner", entry.getOwnerId().toString());
        }
        raise.raise(org, PlatformEvents.RESOURCE_REGISTERED, payload);
        return view(entry, details.parent());
    }

    @Override
    public Resource update(ResourceRef ref, Details details) {
        Objects.requireNonNull(details, "details");
        declared(ref);
        UUID org = organization.require();
        RegisteredResource entry = entries.find(org, ref.extension(), ref.type(), ref.id())
                .orElseThrow(() -> new NoSuchElementException("The resource " + ref + " is not registered."));
        UUID parent = parent(org, ref, Optional.of(entry.getId()), details.parent());
        entry.change(details.title(), details.link(), parent, Instant.now(clock));
        entries.update(entry);
        return view(entry, details.parent());
    }

    @Override
    public void remove(ResourceRef ref) {
        declared(ref);
        UUID org = organization.require();
        entries.find(org, ref.extension(), ref.type(), ref.id()).ifPresent(entry -> {
            entries.delete(entry);
            raise.raise(org, PlatformEvents.RESOURCE_REMOVED, refPayload(ref));
        });
    }

    private static Map<String, Object> refPayload(ResourceRef ref) {
        return Map.of("extension", ref.extension(), "type", ref.type(), "id", ref.id());
    }

    @Override
    public Optional<Resource> find(ResourceRef ref) {
        declared(ref);
        UUID org = organization.require();
        return entries.find(org, ref.extension(), ref.type(), ref.id())
                .map(entry -> view(entry, parentRef(org, entry)));
    }

    @Override
    public List<Resource> list(String extension, String type, UUID owner) {
        Objects.requireNonNull(extension, "extension");
        Objects.requireNonNull(type, "type");
        declared(extension, type);
        UUID org = organization.require();
        List<RegisteredResource> found =
                owner == null ? entries.list(org, extension, type) : entries.listOwnedBy(org, extension, type, owner);
        List<UUID> parentIds = found.stream()
                .map(RegisteredResource::getParentId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        Map<UUID, ResourceRef> parents = parentIds.isEmpty()
                ? Map.of()
                : entries.findByIds(org, parentIds).stream()
                        .collect(Collectors.toMap(RegisteredResource::getId, RegisteredResource::ref));
        return found.stream()
                .map(entry -> view(entry, entry.getParentId() == null ? null : parents.get(entry.getParentId())))
                .toList();
    }

    /**
     * Removes, in every organization, the entries of the extensions that are no longer installed
     * (MK-054): uninstalling an extension takes effect at the next start (ADR-0004), and leaves none
     * of its entries behind. Runs as the owner of the tables, outside requests, so that row-level
     * security does not hide the entries of other organizations.
     *
     * @param installedExtensions the identifiers of every extension found in the installation, active
     *     or not: an extension that is only incompatible keeps its entries. When none is found
     *     nothing is removed: an extensions directory that is missing or misconfigured must not wipe
     *     the registry and every grant built on it.
     * @return how many entries were removed
     */
    public int forgetUninstalled(Collection<String> installedExtensions) {
        List<String> keep = List.copyOf(new HashSet<>(installedExtensions));
        if (keep.isEmpty()) {
            LOG.warn("No extension found in the installation: the registered resources are kept");
            return 0;
        }
        int removed = entries.deleteAllExcept(keep);
        if (removed > 0) {
            LOG.infof("Removed %d registered resources of extensions that are no longer installed", removed);
        }
        return removed;
    }

    void onExtensionsLoaded(@Observes ExtensionsLoaded event) {
        forgetUninstalled(installed.get());
    }

    /** Refuses a reference of a type that the named extension does not declare, or of no active extension. */
    private void declared(ResourceRef ref) {
        Objects.requireNonNull(ref, "ref");
        declared(ref.extension(), ref.type());
    }

    private void declared(String extension, String type) {
        ExtensionManifest manifest = manifests
                .apply(extension)
                .orElseThrow(() -> new IllegalArgumentException(extension + " is not an active extension."));
        if (manifest.resourceType(type).isEmpty()) {
            throw new IllegalArgumentException(
                    "The extension " + extension + " does not declare the resource type " + type + ".");
        }
    }

    /**
     * The id of the entry of the parent: a resource registered in the organization, that is not the
     * resource itself nor contained in it.
     */
    private UUID parent(UUID org, ResourceRef ref, Optional<UUID> self, ResourceRef parent) {
        if (parent == null) {
            return null;
        }
        if (parent.equals(ref)) {
            throw new IllegalArgumentException("A resource cannot be its own parent.");
        }
        RegisteredResource entry = entries.find(org, parent.extension(), parent.type(), parent.id())
                .orElseThrow(() -> new IllegalArgumentException(
                        "The parent " + parent + " is not a resource of the organization."));
        if (self.isPresent()) {
            Set<UUID> seen = new HashSet<>();
            UUID ancestor = entry.getId();
            for (int depth = 0; ancestor != null && depth < MAX_DEPTH && seen.add(ancestor); depth++) {
                if (ancestor.equals(self.get())) {
                    throw new IllegalArgumentException(
                            "The parent " + parent + " is contained in " + ref + ", which cannot contain itself.");
                }
                ancestor = entries.findById(ancestor)
                        .map(RegisteredResource::getParentId)
                        .orElse(null);
            }
        }
        return entry.getId();
    }

    private ResourceRef parentRef(UUID org, RegisteredResource entry) {
        if (entry.getParentId() == null) {
            return null;
        }
        return entries.findByIds(org, List.of(entry.getParentId())).stream()
                .findFirst()
                .map(RegisteredResource::ref)
                .orElse(null);
    }

    private static Resource view(RegisteredResource entry, ResourceRef parent) {
        return new Resource(
                entry.ref(), entry.getOrganizationId(), entry.getOwnerId(), entry.getTitle(), entry.getLink(), parent);
    }
}
