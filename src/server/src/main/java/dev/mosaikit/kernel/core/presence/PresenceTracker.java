// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.presence;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.core.apps.AppSettings;
import dev.mosaikit.kernel.core.extension.ExtensionsReloaded;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.Organizations;
import io.quarkus.narayana.jta.QuarkusTransaction;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.persistence.EntityManager;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.stream.Collectors;
import org.jboss.logging.Logger;

/**
 * Follows the extensions active in the installation (MK-133): each time the kernel reads the
 * extensions directory, at start too, it compares them with those it recorded the last time, in the
 * database, and tells every organization where an extension became active (installed, updated) or
 * inactive (removed, no longer able to run), unless the organization had turned it off. The record is
 * read under a lock, so that of several kernels of an installation that start together only one tells
 * each change. On the first start, or when the record cannot be read, there is nothing to compare with:
 * the extensions are recorded and nothing is told.
 */
@ApplicationScoped
public class PresenceTracker {

    private static final Logger LOG = Logger.getLogger(PresenceTracker.class);

    private final EntityManager entityManager;
    private final Organizations organizations;
    private final AppSettings apps;
    private final PresenceNotices notices;
    private final ObjectMapper json;

    public PresenceTracker(
            EntityManager entityManager,
            Organizations organizations,
            AppSettings apps,
            PresenceNotices notices,
            ObjectMapper json) {
        this.entityManager = entityManager;
        this.organizations = organizations;
        this.apps = apps;
        this.notices = notices;
        this.json = json;
    }

    void onReloaded(@Observes ExtensionsReloaded reloaded) {
        try {
            // As the kernel, on a thread without the request that installed or removed an extension, if
            // any: the record and the settings of every organization are read as their owner, which a
            // connection taken during a request never is.
            CompletableFuture.runAsync(() -> QuarkusTransaction.requiringNew().run(() -> follow(reloaded)))
                    .join();
        } catch (RuntimeException e) {
            LOG.warnf(e, "Cannot tell the organizations which extensions became active or inactive");
        }
    }

    /** Compares the active extensions with those recorded, tells the changes and records them. */
    void follow(ExtensionsReloaded reloaded) {
        Map<String, String> now = new TreeMap<>();
        reloaded.active()
                .forEach(extension -> extension
                        .manifest()
                        .ifPresent(manifest ->
                                now.put(manifest.id(), manifest.version().toString())));
        Set<String> installed = reloaded.all().stream()
                .filter(extension -> extension.manifest().isPresent())
                .map(InstalledExtension::key)
                .collect(Collectors.toSet());
        Optional<Map<String, String>> recorded = recorded();
        if (recorded.isEmpty()) {
            entityManager
                    .createNativeQuery("insert into {h-schema}extension_presence (id, active) values (1, :active)"
                            + " on conflict (id) do update set active = excluded.active, updated_at = now()")
                    .setParameter("active", write(now))
                    .executeUpdate();
            return;
        }
        List<PresenceNotices.Change> changes = changes(recorded.get(), now, installed);
        if (changes.isEmpty()) {
            return;
        }
        for (Organization organization : organizations.findAllOrderedByName()) {
            UUID id = organization.getId();
            for (PresenceNotices.Change change : changes) {
                boolean off = change.reason().active()
                        ? apps.isOff(id, change.extension())
                        : apps.turnedOffBySettings(id, change.extension());
                if (!off) {
                    notices.tell(id, change);
                }
            }
        }
        entityManager
                .createNativeQuery("update {h-schema}extension_presence set active = :active, updated_at = now()"
                        + " where id = 1")
                .setParameter("active", write(now))
                .executeUpdate();
        LOG.infof("Extensions that became active or inactive: %s", changes);
    }

    /**
     * What changed between two sets of active extensions, by identifier and version.
     *
     * @param installed the extensions installed now, active or not: one that is no longer active but
     *     still installed cannot run, rather than being removed
     */
    static List<PresenceNotices.Change> changes(
            Map<String, String> before, Map<String, String> now, Set<String> installed) {
        Set<String> ids = new TreeSet<>(before.keySet());
        ids.addAll(now.keySet());
        List<PresenceNotices.Change> changes = new ArrayList<>();
        for (String id : ids) {
            String was = before.get(id);
            String is = now.get(id);
            if (was == null) {
                changes.add(new PresenceNotices.Change(id, is, null, PresenceNotices.Reason.INSTALLED));
            } else if (is == null) {
                changes.add(new PresenceNotices.Change(
                        id,
                        was,
                        null,
                        installed.contains(id) ? PresenceNotices.Reason.INCOMPATIBLE : PresenceNotices.Reason.REMOVED));
            } else if (!Objects.equals(was, is)) {
                changes.add(new PresenceNotices.Change(id, is, was, PresenceNotices.Reason.UPDATED));
            }
        }
        return changes;
    }

    private Optional<Map<String, String>> recorded() {
        List<?> found = entityManager
                .createNativeQuery("select active from {h-schema}extension_presence where id = 1 for update")
                .getResultList();
        if (found.isEmpty()) {
            return Optional.empty();
        }
        try {
            return Optional.of(
                    json.readValue(String.valueOf(found.getFirst()), new TypeReference<Map<String, String>>() {}));
        } catch (JsonProcessingException e) {
            LOG.warnf("The extensions recorded as active cannot be read; recording them again: %s", e.getMessage());
            return Optional.empty();
        }
    }

    private String write(Map<String, String> active) {
        try {
            return json.writeValueAsString(active);
        } catch (JsonProcessingException e) {
            throw new IllegalStateException("Cannot write the active extensions", e);
        }
    }
}
