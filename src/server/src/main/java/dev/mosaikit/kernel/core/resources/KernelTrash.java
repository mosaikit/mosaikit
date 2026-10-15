// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.resources;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.context.NoOrganizationException;
import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.Trash;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.events.PlatformEventLog;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import jakarta.transaction.Transactional;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The trash of the registered resources (MK-095), the kernel's {@link Trash} bean, and the page
 * <em>Trash</em> of the shell. A resource in the trash keeps its entry, its grants and the data of its
 * extension; {@code mk_kernel.lineage()} (V41) and {@code Lineage} give no level on it, so its grants and
 * links work again, as they were, once it is restored. The resources inside it, by the parent of the
 * registry, go and come back with it: {@code trash_root_id} names the resource whose trashing took
 * them.
 *
 * <p>Every call acts on the organization of the request, under row-level security, and joins the
 * transaction of the caller. {@link TrashPurges} deletes for good the resources whose retention is
 * past, as the owner of the tables.
 */
@ApplicationScoped
@Transactional(
        dontRollbackOn = {IllegalArgumentException.class, NoSuchElementException.class, NoOrganizationException.class})
public class KernelTrash implements Trash {

    /** The shortest retention, whatever the setting says. */
    public static final Duration MIN_RETENTION = Duration.ofDays(1);

    /** How many resources the page lists at most, the most recently trashed first. */
    static final int MAX_LISTED = 500;

    static final String TRASHED = "resource.trashed";
    static final String RESTORED = "resource.restored";
    static final String PURGED = "resource.purged";

    /**
     * A resource in the trash, as the page lists it: one that was trashed, not those that went with it.
     *
     * @param id the entry of the registry
     * @param contents how many resources went to the trash with it
     */
    public record Trashed(
            UUID id,
            String extension,
            String extensionName,
            String type,
            String typeTitle,
            String resourceId,
            String title,
            UUID owner,
            String ownerName,
            Instant trashedAt,
            String trashedByName,
            Instant purgeableFrom,
            long contents) {}

    private final RegisteredResources entries;
    private final EntityManager entityManager;
    private final ExtensionRegistry extensions;
    private final CurrentOrganization organization;
    private final SecurityIdentity identity;
    private final PlatformEventLog events;
    private final AuditLog audit;
    private final Duration retention;
    private final Clock clock;

    public KernelTrash(
            RegisteredResources entries,
            EntityManager entityManager,
            ExtensionRegistry extensions,
            CurrentOrganization organization,
            SecurityIdentity identity,
            PlatformEventLog events,
            AuditLog audit,
            KernelConfig config,
            Clock clock) {
        this.entries = entries;
        this.entityManager = entityManager;
        this.extensions = extensions;
        this.organization = organization;
        this.identity = identity;
        this.events = events;
        this.audit = audit;
        this.retention = retention(config.trash().retention());
        this.clock = clock;
    }

    /** The retention of a setting, never shorter than {@link #MIN_RETENTION}. */
    public static Duration retention(Duration configured) {
        return configured == null || configured.compareTo(MIN_RETENTION) < 0 ? MIN_RETENTION : configured;
    }

    @Override
    public List<ResourceRef> trash(ResourceRef ref) {
        declared(ref);
        UUID org = organization.require();
        RegisteredResource entry = entries.find(org, ref.extension(), ref.type(), ref.id())
                .orElseThrow(() -> new NoSuchElementException("The resource " + ref + " is not registered."));
        if (entry.inTrash()) {
            return List.of();
        }
        Instant now = Instant.now(clock).truncatedTo(ChronoUnit.MICROS);
        Instant purgeableFrom = now.plus(retention);
        @SuppressWarnings("unchecked")
        List<Object> below = entityManager
                .createNativeQuery("select c.id from {h-schema}resource_contents(:id) c"
                        + " join {h-schema}resource r on r.id = c.id"
                        + " where r.trashed_at is null order by c.depth")
                .setParameter("id", entry.getId())
                .getResultList();
        List<UUID> ids = new ArrayList<>();
        ids.add(entry.getId());
        below.forEach(id -> ids.add((UUID) id));
        UUID by = person().orElse(null);
        entityManager
                .createNativeQuery("update {h-schema}resource set trashed_at = :now, trashed_by = cast(:by as uuid),"
                        + " trash_root_id = :root, purgeable_from = :from"
                        + " where organization_id = :org and id in (:ids) and trashed_at is null")
                .setParameter("now", Timestamp.from(now))
                .setParameter("by", by == null ? null : by.toString())
                .setParameter("root", entry.getId())
                .setParameter("from", Timestamp.from(purgeableFrom))
                .setParameter("org", org)
                .setParameter("ids", ids)
                .executeUpdate();
        List<RegisteredResource> moved = inOrder(ids, entries.findByIds(org, ids));
        for (RegisteredResource resource : moved) {
            Map<String, Object> payload = payload(resource);
            payload.put("purgeableFrom", purgeableFrom.toString());
            events.raise(org, PlatformEvents.RESOURCE_TRASHED, payload);
        }
        audit(org, TRASHED, entry, moved.size() - 1, Map.of("purgeableFrom", purgeableFrom.toString()));
        return moved.stream().map(RegisteredResource::ref).toList();
    }

    @Override
    public List<ResourceRef> restore(ResourceRef ref) {
        declared(ref);
        UUID org = organization.require();
        RegisteredResource entry = entries.find(org, ref.extension(), ref.type(), ref.id())
                .orElseThrow(() -> new NoSuchElementException("The resource " + ref + " is not registered."));
        if (!entry.inTrash()) {
            return List.of();
        }
        Optional<String> refused = refusal(org, entry);
        if (refused.isPresent()) {
            throw new IllegalArgumentException(refused.get());
        }
        return restore(org, entry).stream().map(RegisteredResource::ref).toList();
    }

    @Override
    public boolean contains(ResourceRef ref) {
        declared(ref);
        UUID org = organization.require();
        return entries.find(org, ref.extension(), ref.type(), ref.id())
                .map(RegisteredResource::inTrash)
                .orElse(false);
    }

    @Override
    public Set<String> trashed(String extension, String type) {
        Objects.requireNonNull(extension, "extension");
        Objects.requireNonNull(type, "type");
        declared(extension, type);
        UUID org = organization.require();
        return Set.copyOf(entries.trashed(org, extension, type));
    }

    /**
     * The trash of the person of the request: the resources they own that were trashed, or, for an
     * administrator who asks, those of the whole organization, the most recently trashed first.
     *
     * @throws ForbiddenOperationException when a person who does not
     *     administer the organization asks for the whole organization
     */
    public List<Trashed> list(boolean wholeOrganization) {
        UUID org = organization.require();
        UUID me = person().orElseThrow(() ->
                new ForbiddenOperationException("Only a person signed in to the organization has a trash."));
        if (wholeOrganization && !RequestOrganization.administrator(identity)) {
            throw new ForbiddenOperationException("Only the administrators of the organization see its whole trash.");
        }
        Query query = entityManager
                .createNativeQuery("select r.id, r.extension_id, r.type, r.ref_id, r.title, r.owner_id, o.display_name,"
                        + " r.trashed_at, t.display_name, r.purgeable_from,"
                        + " (select count(*) from {h-schema}resource c where c.trash_root_id = r.id and c.id <> r.id)"
                        + " from {h-schema}resource r"
                        + " left join {h-schema}user_account o on o.id = r.owner_id"
                        + " left join {h-schema}user_account t on t.id = r.trashed_by"
                        + " where r.organization_id = :org and r.trash_root_id = r.id"
                        + (wholeOrganization ? "" : " and r.owner_id = :me")
                        + " order by r.trashed_at desc, r.title")
                .setParameter("org", org)
                .setMaxResults(MAX_LISTED);
        if (!wholeOrganization) {
            query.setParameter("me", me);
        }
        @SuppressWarnings("unchecked")
        List<Object[]> rows = query.getResultList();
        Map<String, Optional<ExtensionManifest>> manifests = extensions.all().stream()
                .collect(Collectors.toMap(InstalledExtension::key, InstalledExtension::manifest, (a, b) -> a));
        return rows.stream()
                .map(row -> {
                    String extension = (String) row[1];
                    String type = (String) row[2];
                    Optional<ExtensionManifest> manifest = manifests.getOrDefault(extension, Optional.empty());
                    return new Trashed(
                            (UUID) row[0],
                            extension,
                            manifest.map(ExtensionManifest::name).orElse(extension),
                            type,
                            manifest.flatMap(found -> found.resourceType(type))
                                    .map(ResourceTypeEntry::title)
                                    .orElse(type),
                            (String) row[3],
                            (String) row[4],
                            (UUID) row[5],
                            (String) row[6],
                            instant(row[7]),
                            (String) row[8],
                            instant(row[9]),
                            ((Number) row[10]).longValue());
                })
                .toList();
    }

    /**
     * Restores a resource of the trash of the person of the request, with what went with it.
     *
     * @throws ResourceNotFoundException when it is not in their trash
     * @throws ConflictException when the resource that contains it is in the trash
     */
    public List<ResourceRef> restoreFromPage(UUID id) {
        UUID org = organization.require();
        RegisteredResource entry = ofMyTrash(org, id);
        Optional<String> refused = refusal(org, entry);
        if (refused.isPresent()) {
            throw new ConflictException(refused.get());
        }
        return restore(org, entry).stream().map(RegisteredResource::ref).toList();
    }

    /**
     * Deletes for good a resource of the trash of the person of the request, with what went with it.
     *
     * @throws ResourceNotFoundException when it is not in their trash
     */
    public int purgeFromPage(UUID id) {
        UUID org = organization.require();
        RegisteredResource entry = ofMyTrash(org, id);
        return purge(org, entry.getId(), AuditEvent.Channel.WEB, actor(), "deleted");
    }

    /**
     * Deletes for good a resource that was trashed, with the resources that went with it: raises
     * {@link PlatformEvents#RESOURCE_PURGED} for each, then removes their entries, and so their grants.
     * Used by the page and by {@link TrashPurges}, which calls it as the owner of the tables.
     *
     * @return how many resources were deleted
     */
    int purge(UUID org, UUID root, AuditEvent.Channel channel, String actor, String reason) {
        @SuppressWarnings("unchecked")
        List<Object> ids = entityManager
                .createNativeQuery("select id from {h-schema}resource"
                        + " where organization_id = :org and trash_root_id = :root and trashed_at is not null")
                .setParameter("org", org)
                .setParameter("root", root)
                .getResultList();
        if (ids.isEmpty()) {
            return 0;
        }
        List<UUID> members = ids.stream().map(id -> (UUID) id).toList();
        List<RegisteredResource> purged = inOrder(members, entries.findByIds(org, members));
        RegisteredResource first = purged.stream()
                .filter(entry -> entry.getId().equals(root))
                .findFirst()
                .orElse(purged.getFirst());
        for (RegisteredResource resource : purged) {
            events.raise(org, PlatformEvents.RESOURCE_PURGED, payload(resource));
        }
        int deleted = entityManager
                .createNativeQuery("delete from {h-schema}resource"
                        + " where organization_id = :org and trash_root_id = :root and trashed_at is not null")
                .setParameter("org", org)
                .setParameter("root", root)
                .executeUpdate();
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("contents", deleted - 1);
        detail.put("reason", reason);
        detail.put("trashedAt", String.valueOf(first.getTrashedAt()));
        audit.append(
                channel, actor, Optional.of(org), PURGED, first.ref().toString(), AuditEvent.Outcome.SUCCEEDED, detail);
        return deleted;
    }

    /** Whether a resource is in the trash; for the kernel, which names no extension. */
    public boolean inTrash(UUID org, ResourceRef ref) {
        return entries.find(org, ref.extension(), ref.type(), ref.id())
                .map(RegisteredResource::inTrash)
                .orElse(false);
    }

    private List<RegisteredResource> restore(UUID org, RegisteredResource entry) {
        @SuppressWarnings("unchecked")
        List<Object> ids = entityManager
                .createNativeQuery(
                        "select id from {h-schema}resource where organization_id = :org" + " and trash_root_id = :root")
                .setParameter("org", org)
                .setParameter("root", entry.getId())
                .getResultList();
        List<UUID> members = new ArrayList<>();
        members.add(entry.getId());
        ids.stream()
                .map(id -> (UUID) id)
                .filter(id -> !id.equals(entry.getId()))
                .forEach(members::add);
        entityManager
                .createNativeQuery("update {h-schema}resource set trashed_at = null, trashed_by = null,"
                        + " trash_root_id = null, purgeable_from = null"
                        + " where organization_id = :org and trash_root_id = :root")
                .setParameter("org", org)
                .setParameter("root", entry.getId())
                .executeUpdate();
        List<RegisteredResource> restored = inOrder(members, entries.findByIds(org, members));
        for (RegisteredResource resource : restored) {
            events.raise(org, PlatformEvents.RESOURCE_RESTORED, payload(resource));
        }
        audit(org, RESTORED, entry, restored.size() - 1, Map.of());
        return restored;
    }

    /** Why a resource in the trash cannot be restored on its own, if it cannot. */
    private Optional<String> refusal(UUID org, RegisteredResource entry) {
        if (!entry.getId().equals(entry.getTrashRootId())) {
            return Optional.of("The resource " + entry.ref()
                    + " went to the trash with the resource that contains it: restore that one.");
        }
        if (entry.getParentId() != null) {
            boolean parentInTrash = entries.findByIds(org, List.of(entry.getParentId())).stream()
                    .anyMatch(RegisteredResource::inTrash);
            if (parentInTrash) {
                return Optional.of(
                        "The resource that contains " + entry.ref() + " is in the trash: restore that one first.");
            }
        }
        return Optional.empty();
    }

    /** A resource that was trashed, of the trash of the person of the request: theirs, or any for an administrator. */
    private RegisteredResource ofMyTrash(UUID org, UUID id) {
        Optional<UUID> me = person();
        boolean administrator = RequestOrganization.administrator(identity);
        return entries.findByIds(org, List.of(id)).stream()
                .filter(entry -> entry.inTrash() && entry.getId().equals(entry.getTrashRootId()))
                .filter(entry -> administrator || (me.isPresent() && me.get().equals(entry.getOwnerId())))
                .findFirst()
                .orElseThrow(() -> new ResourceNotFoundException("The resource " + id + " is not in your trash."));
    }

    private void audit(UUID org, String action, RegisteredResource entry, int contents, Map<String, String> more) {
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("contents", contents);
        detail.putAll(more);
        audit.append(actor(), Optional.of(org), action, entry.ref().toString(), AuditEvent.Outcome.SUCCEEDED, detail);
    }

    private String actor() {
        String name =
                identity.getPrincipal() == null ? null : identity.getPrincipal().getName();
        return name == null || name.isBlank() ? "kernel" : name;
    }

    private Optional<UUID> person() {
        return RequestOrganization.account(identity);
    }

    private static Map<String, Object> payload(RegisteredResource resource) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("extension", resource.getExtensionId());
        payload.put("type", resource.getResourceType());
        payload.put("id", resource.getRefId());
        payload.put("title", resource.getTitle());
        if (resource.getOwnerId() != null) {
            payload.put("owner", resource.getOwnerId().toString());
        }
        return payload;
    }

    /** The entries in the order of their ids. */
    private static List<RegisteredResource> inOrder(List<UUID> ids, List<RegisteredResource> found) {
        Map<UUID, RegisteredResource> byId =
                found.stream().collect(Collectors.toMap(RegisteredResource::getId, Function.identity()));
        return ids.stream().map(byId::get).filter(Objects::nonNull).toList();
    }

    /** Refuses a reference of a type that the named extension does not declare, or of no active extension. */
    private void declared(ResourceRef ref) {
        Objects.requireNonNull(ref, "ref");
        declared(ref.extension(), ref.type());
    }

    private void declared(String extension, String type) {
        ExtensionManifest manifest = extensions
                .findActive(extension)
                .flatMap(InstalledExtension::manifest)
                .orElseThrow(() -> new IllegalArgumentException(extension + " is not an active extension."));
        if (manifest.resourceType(type).isEmpty()) {
            throw new IllegalArgumentException(
                    "The extension " + extension + " does not declare the resource type " + type + ".");
        }
    }

    static Instant instant(Object value) {
        return switch (value) {
            case null -> null;
            case Instant instant -> instant;
            case Timestamp timestamp -> timestamp.toInstant();
            case OffsetDateTime offset -> offset.toInstant();
            default -> throw new IllegalStateException("Not a time: " + value);
        };
    }
}
