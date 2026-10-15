// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.presence;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ExtensionPresence;
import dev.mosaikit.kernel.api.version.Version;
import dev.mosaikit.kernel.core.apps.AppSettings;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Whether an extension is active in an organization (MK-133): active in the installation (installed,
 * compatible with the kernel and with what it requires), and not turned off by the organization
 * (MK-030). Of the others it says only that they are absent.
 */
@ApplicationScoped
public class KernelExtensionPresence implements ExtensionPresence {

    /**
     * An extension active in an organization, as the shell receives it.
     *
     * @param id its identifier
     * @param version its version
     */
    public record Active(String id, String version) {}

    private final ExtensionRegistry registry;
    private final AppSettings apps;
    private final CurrentOrganization organization;

    public KernelExtensionPresence(ExtensionRegistry registry, AppSettings apps, CurrentOrganization organization) {
        this.registry = registry;
        this.apps = apps;
        this.organization = organization;
    }

    @Override
    public boolean isActive(String extension) {
        return version(extension).isPresent();
    }

    @Override
    public Optional<Version> version(String extension) {
        Objects.requireNonNull(extension, "extension");
        Optional<UUID> in = organization.id();
        return registry.findActive(extension)
                .flatMap(InstalledExtension::manifest)
                .filter(manifest -> in.map(id -> !apps.isOff(id, extension)).orElse(true))
                .map(ExtensionManifest::version);
    }

    /** The extensions active in an organization, by identifier; in the installation without one. */
    public List<Active> activeIn(Optional<UUID> organizationId) {
        return registry.active().stream()
                .flatMap(extension -> extension.manifest().stream())
                .filter(manifest ->
                        organizationId.map(id -> !apps.isOff(id, manifest.id())).orElse(true))
                .map(manifest -> new Active(manifest.id(), manifest.version().toString()))
                .sorted(Comparator.comparing(Active::id))
                .toList();
    }
}
