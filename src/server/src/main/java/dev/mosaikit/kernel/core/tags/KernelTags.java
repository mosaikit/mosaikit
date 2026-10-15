// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.tags;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.context.NoOrganizationException;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.Tags;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.resources.RegisteredResource;
import dev.mosaikit.kernel.core.resources.RegisteredResources;
import dev.mosaikit.kernel.core.sharing.KernelSharing;
import jakarta.data.Limit;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Predicate;

/**
 * Free tags on the resources of extensions (MK-097), the kernel's {@link Tags} bean. Every call acts
 * on the organization of the request and joins the transaction of the caller. A documented exception
 * is thrown before anything is written, and leaves the transaction of the caller usable, as in the
 * registry of resources.
 */
@ApplicationScoped
@Transactional(
        dontRollbackOn = {IllegalArgumentException.class, NoSuchElementException.class, NoOrganizationException.class})
public class KernelTags implements Tags {

    /** How many tags of resources a suggestion reads at most, before keeping those the request may read. */
    static final int SCANNED = 2000;

    private final ResourceTags tags;
    private final RegisteredResources entries;
    private final Function<String, Optional<ExtensionManifest>> manifests;
    private final CurrentOrganization organization;
    private final Function<List<RegisteredResource>, Set<UUID>> readable;
    private final Clock clock;

    @Inject
    public KernelTags(
            ResourceTags tags,
            RegisteredResources entries,
            ExtensionRegistry extensions,
            CurrentOrganization organization,
            KernelSharing sharing) {
        this(
                tags,
                entries,
                id -> extensions.findActive(id).flatMap(InstalledExtension::manifest),
                organization,
                sharing::readable,
                Clock.systemUTC());
    }

    KernelTags(
            ResourceTags tags,
            RegisteredResources entries,
            Function<String, Optional<ExtensionManifest>> manifests,
            CurrentOrganization organization,
            Function<List<RegisteredResource>, Set<UUID>> readable,
            Clock clock) {
        this.tags = tags;
        this.entries = entries;
        this.manifests = manifests;
        this.organization = organization;
        this.readable = readable;
        this.clock = clock;
    }

    @Override
    public List<String> of(ResourceRef ref) {
        RegisteredResource entry = entry(ref);
        return tags.of(entry.getOrganizationId(), entry.getId());
    }

    @Override
    public List<String> attach(ResourceRef ref, Collection<String> added) {
        List<String> normalized = Tags.normalizeAll(added);
        RegisteredResource entry = entry(ref);
        List<String> held = tags.of(entry.getOrganizationId(), entry.getId());
        List<String> missing =
                normalized.stream().filter(Predicate.not(held::contains)).toList();
        if (held.size() + missing.size() > MAX_PER_RESOURCE) {
            throw new IllegalArgumentException("a resource has at most " + MAX_PER_RESOURCE + " tags");
        }
        insert(entry, missing);
        return tags.of(entry.getOrganizationId(), entry.getId());
    }

    @Override
    public List<String> replace(ResourceRef ref, Collection<String> replaced) {
        List<String> normalized = Tags.normalizeAll(replaced);
        if (normalized.size() > MAX_PER_RESOURCE) {
            throw new IllegalArgumentException("a resource has at most " + MAX_PER_RESOURCE + " tags");
        }
        RegisteredResource entry = entry(ref);
        UUID org = entry.getOrganizationId();
        if (normalized.isEmpty()) {
            tags.deleteAll(org, entry.getId());
            return List.of();
        }
        tags.deleteAllExcept(org, entry.getId(), normalized);
        List<String> held = tags.of(org, entry.getId());
        insert(entry, normalized.stream().filter(Predicate.not(held::contains)).toList());
        return tags.of(org, entry.getId());
    }

    @Override
    public Set<String> tagged(String extension, String type, Collection<String> wanted) {
        Objects.requireNonNull(extension, "extension");
        Objects.requireNonNull(type, "type");
        declared(extension, type);
        List<String> normalized = Tags.normalizeAll(wanted);
        UUID org = organization.require();
        if (normalized.isEmpty()) {
            return Set.of();
        }
        return Set.copyOf(tags.tagged(org, extension, type, normalized));
    }

    @Override
    public List<String> suggest(String prefix, int limit) {
        Optional<UUID> org = organization.id();
        String typed = typed(prefix);
        if (org.isEmpty() || limit < 1 || typed.length() > MAX_LENGTH) {
            return List.of();
        }
        List<ResourceTag> found = tags.matching(org.get(), escape(typed) + "%", Limit.of(SCANNED));
        if (found.isEmpty()) {
            return List.of();
        }
        List<UUID> ids =
                found.stream().map(ResourceTag::getResourceId).distinct().toList();
        Set<UUID> seen = readable.apply(entries.findByIds(org.get(), ids));
        Map<String, Integer> uses = new HashMap<>();
        for (ResourceTag tag : found) {
            if (seen.contains(tag.getResourceId())) {
                uses.merge(tag.getTag(), 1, Integer::sum);
            }
        }
        return uses.entrySet().stream()
                .sorted(Map.Entry.<String, Integer>comparingByValue(Comparator.reverseOrder())
                        .thenComparing(Map.Entry.comparingByKey()))
                .limit(Math.min(limit, MAX_SUGGESTIONS))
                .map(Map.Entry::getKey)
                .toList();
    }

    private void insert(RegisteredResource entry, List<String> added) {
        Instant now = Instant.now(clock);
        for (String tag : added) {
            tags.insert(new ResourceTag(entry.getOrganizationId(), entry.getId(), tag, now));
        }
    }

    /** The entry of a registered resource of a type the named extension declares. */
    private RegisteredResource entry(ResourceRef ref) {
        Objects.requireNonNull(ref, "ref");
        declared(ref.extension(), ref.type());
        UUID org = organization.require();
        return entries.find(org, ref.extension(), ref.type(), ref.id())
                .orElseThrow(() -> new NoSuchElementException("The resource " + ref + " is not registered."));
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

    /** What a person typed, in the form of a tag; empty when nothing. */
    static String typed(String prefix) {
        return prefix == null ? "" : prefix.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
    }

    /** What was typed, as the literal start of a pattern of {@code like} with the escape {@code !}. */
    static String escape(String typed) {
        return typed.replace("!", "!!").replace("%", "!%").replace("_", "!_");
    }
}
