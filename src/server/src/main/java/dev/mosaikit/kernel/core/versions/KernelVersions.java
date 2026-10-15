// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.versions;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.context.NoOrganizationException;
import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.extension.SharingLevelEntry;
import dev.mosaikit.kernel.api.files.FileStorage;
import dev.mosaikit.kernel.api.files.StoredFile;
import dev.mosaikit.kernel.api.permission.AccessDeniedException;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.Versions;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.resources.RegisteredResource;
import dev.mosaikit.kernel.core.resources.RegisteredResources;
import dev.mosaikit.kernel.core.sharing.KernelSharing;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import org.jboss.logging.Logger;

/**
 * The version history of the resources of extensions (MK-096), the kernel's {@link Versions} bean.
 * Every call acts on the organization of the request and joins the transaction of the caller. A
 * documented exception is thrown before anything is written, and leaves the transaction of the caller
 * usable, as in the registry of resources.
 */
@ApplicationScoped
@Transactional(
        dontRollbackOn = {
            IllegalArgumentException.class,
            AccessDeniedException.class,
            NoSuchElementException.class,
            NoOrganizationException.class
        })
public class KernelVersions implements Versions {

    private static final Logger LOG = Logger.getLogger(KernelVersions.class);

    private final ResourceVersions versions;
    private final RegisteredResources entries;
    private final KernelSharing sharing;
    private final FileStorage files;
    private final CurrentOrganization organization;
    private final SecurityIdentity identity;
    private final KernelConfig config;
    private final AuditLog audit;
    private final EntityManager entityManager;
    private final Clock clock = Clock.systemUTC();
    private final AtomicBoolean warned = new AtomicBoolean();

    @Inject
    public KernelVersions(
            ResourceVersions versions,
            RegisteredResources entries,
            KernelSharing sharing,
            FileStorage files,
            CurrentOrganization organization,
            SecurityIdentity identity,
            KernelConfig config,
            AuditLog audit,
            EntityManager entityManager) {
        this.versions = versions;
        this.entries = entries;
        this.sharing = sharing;
        this.files = files;
        this.organization = organization;
        this.identity = identity;
        this.config = config;
        this.audit = audit;
        this.entityManager = entityManager;
    }

    @Override
    public Saved save(ResourceRef ref, Content content) {
        Objects.requireNonNull(content, "content");
        sharing.typeOf(Objects.requireNonNull(ref, "ref"));
        RegisteredResource entry = entry(ref);
        String mediaType = content.mediaType();
        long size;
        if (content.isFile()) {
            StoredFile file = files.find(ref.extension(), content.file())
                    .orElseThrow(() -> new IllegalArgumentException(
                            "The file " + content.file() + " is not a file of " + ref.extension() + "."));
            mediaType = file.contentType() == null ? OCTET_STREAM : file.contentType();
            size = file.size();
        } else {
            size = content.snapshot().length;
        }
        return write(entry, mediaType, size, content.snapshot(), content.file(), null);
    }

    @Override
    public List<Version> list(ResourceRef ref) {
        ResourceTypeEntry type = sharing.typeOf(Objects.requireNonNull(ref, "ref"));
        RegisteredResource entry = entry(ref);
        sharing.require(ref, lowest(type));
        return versions.of(entry.getOrganizationId(), entry.getId()).stream()
                .map(version -> view(ref, version))
                .toList();
    }

    @Override
    public Content open(ResourceRef ref, UUID id) {
        Objects.requireNonNull(id, "version");
        ResourceTypeEntry type = sharing.typeOf(Objects.requireNonNull(ref, "ref"));
        RegisteredResource entry = entry(ref);
        sharing.require(ref, lowest(type));
        return content(entry, version(entry, ref, id));
    }

    @Override
    public Saved restore(ResourceRef ref, UUID id) {
        Objects.requireNonNull(id, "version");
        ResourceTypeEntry type = sharing.typeOf(Objects.requireNonNull(ref, "ref"));
        RegisteredResource entry = entry(ref);
        sharing.require(ref, editing(type));
        ResourceVersion restored = version(entry, ref, id);
        Content content = content(entry, restored);
        Saved saved = write(
                entry,
                restored.getMediaType(),
                restored.getSize(),
                content.snapshot(),
                content.file(),
                restored.getNumber());
        audit.append(
                identity.isAnonymous()
                        ? ref.extension()
                        : identity.getPrincipal().getName(),
                Optional.of(entry.getOrganizationId()),
                "resource.version.restored",
                ref.toString(),
                AuditEvent.Outcome.SUCCEEDED,
                Map.of(
                        "version",
                        restored.getNumber(),
                        "restoredAs",
                        saved.version().number()));
        return saved;
    }

    /** Writes a version as the newest of the resource, then removes those over the configured number. */
    private Saved write(
            RegisteredResource entry, String mediaType, long size, byte[] snapshot, UUID file, Integer restoredFrom) {
        UUID org = entry.getOrganizationId();
        // One save at a time per resource, so that two saves never take the same number.
        entityManager
                .createNativeQuery("select id from {h-schema}resource where id = :id for update")
                .setParameter("id", entry.getId())
                .getResultList();
        int number = versions.newest(org, entry.getId()) + 1;
        ResourceVersion version = new ResourceVersion(
                org,
                entry.getId(),
                number,
                RequestOrganization.account(identity).orElse(null),
                Instant.now(clock),
                mediaType,
                size,
                snapshot,
                file,
                restoredFrom);
        versions.insert(version);
        ResourceRef ref = entry.ref();
        List<Version> pruned = new ArrayList<>();
        for (ResourceVersion old : toPrune(versions.of(org, entry.getId()), limit())) {
            versions.delete(old);
            pruned.add(view(ref, old));
        }
        return new Saved(view(ref, version), pruned);
    }

    /** The configured number of versions to keep, or 0 when it is not valid and nothing is removed. */
    private int limit() {
        int limit = config.versions().maxPerResource();
        if (limit < 1) {
            if (warned.compareAndSet(false, true)) {
                LOG.warnf(
                        "mosaikit.versions.max-per-resource is %d, below 1: no version of any resource is removed",
                        limit);
            }
            return 0;
        }
        return limit;
    }

    /**
     * The versions to remove so that {@code limit} are kept, oldest first: none when the limit is
     * below 1, a mistake of configuration that must not empty the history; never the newest.
     *
     * @param newestFirst the versions of a resource, newest first
     */
    static <T> List<T> toPrune(List<T> newestFirst, int limit) {
        if (limit < 1 || newestFirst.size() <= limit) {
            return List.of();
        }
        return newestFirst.subList(limit, newestFirst.size()).reversed();
    }

    /** The lowest level of a type, which reads a resource. */
    static String lowest(ResourceTypeEntry type) {
        return type.levels().getFirst().name();
    }

    /** The lowest level of a type that edits, or its highest when none does: edit rights. */
    static String editing(ResourceTypeEntry type) {
        return type.levels().stream()
                .filter(SharingLevelEntry::edits)
                .findFirst()
                .orElse(type.levels().getLast())
                .name();
    }

    private Content content(RegisteredResource entry, ResourceVersion version) {
        if (version.getFileId() != null) {
            return new Content(version.getMediaType(), null, version.getFileId());
        }
        return Content.snapshot(version.getMediaType(), snapshot(entry.getOrganizationId(), version.getId()));
    }

    /** The snapshot of a version, read only when it is opened: the lists do not carry it. */
    private byte[] snapshot(UUID org, UUID id) {
        return entityManager
                .createQuery(
                        "select v.snapshot from ResourceVersion v where v.organizationId = :organization and v.id = :id",
                        byte[].class)
                .setParameter("organization", org)
                .setParameter("id", id)
                .getSingleResult();
    }

    private ResourceVersion version(RegisteredResource entry, ResourceRef ref, UUID id) {
        return versions.find(entry.getOrganizationId(), entry.getId(), id)
                .orElseThrow(() -> new NoSuchElementException("The resource " + ref + " has no version " + id + "."));
    }

    private RegisteredResource entry(ResourceRef ref) {
        UUID org = organization.require();
        return entries.find(org, ref.extension(), ref.type(), ref.id())
                .orElseThrow(() -> new NoSuchElementException("The resource " + ref + " is not registered."));
    }

    private static Version view(ResourceRef ref, ResourceVersion version) {
        return new Version(
                version.getId(),
                ref,
                version.getNumber(),
                version.getAuthorId(),
                version.getCreatedAt(),
                version.getMediaType(),
                version.getSize(),
                version.getFileId(),
                version.getRestoredFrom());
    }
}
