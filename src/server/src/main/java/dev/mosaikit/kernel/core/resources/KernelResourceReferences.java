// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.resources;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ExtensionPresence;
import dev.mosaikit.kernel.api.resource.ResolvedReference;
import dev.mosaikit.kernel.api.resource.ResolvedReference.Availability;
import dev.mosaikit.kernel.api.resource.Resource;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.ResourceReferences;
import dev.mosaikit.kernel.api.resource.Resources;
import dev.mosaikit.kernel.api.sharing.Sharing;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.Predicate;

/**
 * Resolves references between resources of different extensions (MK-135, ADR-0041), the kernel's
 * {@link ResourceReferences} bean: to the entry of the registry when the person of the request may
 * read it, otherwise to the reason it is not available. It only reads: an absent extension never
 * deletes or changes a reference, nor the entries of the registry (turning an extension off keeps
 * them; uninstalling it removes them at the next start, as MK-054 decides, and the extension
 * registers them again when it comes back).
 *
 * <p>The checks go from what anybody may know to what only a reader may: whether the extension is
 * active in the organization (MK-133, as {@link ExtensionPresence} answers), whether the resource is
 * registered, and whether the person has a level on it (MK-055).
 */
@ApplicationScoped
public class KernelResourceReferences implements ResourceReferences {

    private final Predicate<String> callers;
    private final Predicate<String> presence;
    private final Function<String, Optional<ExtensionManifest>> manifests;
    private final Resources registry;
    private final Sharing sharing;
    private final CurrentOrganization organization;

    @Inject
    public KernelResourceReferences(
            ExtensionRegistry extensions,
            ExtensionPresence presence,
            Resources registry,
            Sharing sharing,
            CurrentOrganization organization) {
        this(
                id -> extensions.findActive(id).isPresent(),
                presence::isActive,
                id -> extensions.findActive(id).flatMap(InstalledExtension::manifest),
                registry,
                sharing,
                organization);
    }

    KernelResourceReferences(
            Predicate<String> callers,
            Predicate<String> presence,
            Function<String, Optional<ExtensionManifest>> manifests,
            Resources registry,
            Sharing sharing,
            CurrentOrganization organization) {
        this.callers = callers;
        this.presence = presence;
        this.manifests = manifests;
        this.registry = registry;
        this.sharing = sharing;
        this.organization = organization;
    }

    @Override
    public ResolvedReference resolve(String extension, ResourceRef target) {
        Objects.requireNonNull(extension, "extension");
        if (!callers.test(extension)) {
            throw new IllegalArgumentException(extension + " is not an active extension.");
        }
        return resolve(target);
    }

    /**
     * Resolves a reference for the person of the request, on behalf of the shell, which names no
     * extension: the frontend of an extension asks through the REST API.
     */
    public ResolvedReference resolve(ResourceRef target) {
        Objects.requireNonNull(target, "target");
        organization.require();
        if (!presence.test(target.extension())) {
            return ResolvedReference.unavailable(target, Availability.EXTENSION_ABSENT);
        }
        boolean declared = manifests
                .apply(target.extension())
                .flatMap(manifest -> manifest.resourceType(target.type()))
                .isPresent();
        // A type that the extension no longer declares has no resources any more.
        Optional<Resource> entry = declared ? registry.find(target) : Optional.empty();
        if (entry.isEmpty()) {
            return ResolvedReference.unavailable(target, Availability.DELETED);
        }
        if (sharing.level(target).isEmpty()) {
            return ResolvedReference.unavailable(target, Availability.FORBIDDEN);
        }
        return ResolvedReference.available(entry.get());
    }
}
