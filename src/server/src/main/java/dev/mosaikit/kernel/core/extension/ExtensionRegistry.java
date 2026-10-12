// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import dev.mosaikit.kernel.api.version.Version;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.system.KernelVersion;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Event;
import jakarta.enterprise.event.Observes;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;
import org.jboss.logging.Logger;

/**
 * The extensions of this installation. They are read once at start: installing or removing an extension
 * takes effect at the next restart (see ADR-0004).
 */
@ApplicationScoped
public class ExtensionRegistry {

    private static final Logger LOG = Logger.getLogger(ExtensionRegistry.class);

    private final Path directory;
    private final Optional<Path> providersDirectory;
    private final Path packagesDirectory;
    private final Version kernelVersion;
    private final Path trustedKeysDirectory;
    private final String signatures;
    private final Event<ExtensionsLoaded> loaded;
    private final AtomicReference<List<InstalledExtension>> extensions = new AtomicReference<>(List.of());
    private final AtomicLong revision = new AtomicLong();

    public ExtensionRegistry(KernelConfig config, KernelVersion kernelVersion, Event<ExtensionsLoaded> loaded) {
        this.directory = config.extensions().directory().toAbsolutePath().normalize();
        this.providersDirectory = config.extensions()
                .providersDirectory()
                .map(path -> path.toAbsolutePath().normalize());
        this.packagesDirectory = config.extensions()
                .packagesDirectory()
                .orElseGet(() -> directory.resolve(".packages"))
                .toAbsolutePath()
                .normalize();
        this.kernelVersion = kernelVersion.get();
        this.trustedKeysDirectory =
                config.extensions().trustedKeysDirectory().toAbsolutePath().normalize();
        this.signatures = config.extensions().signatures();
        this.loaded = loaded;
    }

    void onStart(@Observes StartupEvent event) {
        reload();
        loaded.fire(new ExtensionsLoaded(active()));
    }

    /** Reads the installation directory again. */
    public void reload() {
        BackendCheck backendCheck = providersDirectory
                .map(providers -> BackendCheck.loadedBy(
                        ProviderState.read(providers), ProviderState.read(providers, ProviderState.REJECTED_FILE)))
                .orElseGet(BackendCheck::notLoaded);
        PackageTrust trust = PackageTrust.read(trustedKeysDirectory, signatures);
        List<InstalledExtension> found =
                new ExtensionCatalog(kernelVersion, backendCheck, trust).scan(directory, packagesDirectory);
        extensions.set(found);
        revision.incrementAndGet();
        LOG.infof("Extensions in %s: %d found, %d active", directory, found.size(), active().size());
        found.stream()
                .filter(extension -> !extension.isActive())
                .forEach(extension ->
                        LOG.warnf("Extension %s is %s: %s", extension.key(), extension.status(), extension.problems()));
    }

    /** How many times the installation directory was read: changes after every {@link #reload()}. */
    public long revision() {
        return revision.get();
    }

    /** Directory of the installed extensions. */
    public Path directory() {
        return directory;
    }

    /** Where packages are unpacked. */
    public Path packagesDirectory() {
        return packagesDirectory;
    }

    /** Version of the running kernel. */
    public Version kernelVersion() {
        return kernelVersion;
    }

    /** What the installation accepts from publishers, read again from the trusted keys (MK-013). */
    public PackageTrust trust() {
        return PackageTrust.read(trustedKeysDirectory, signatures);
    }

    /** Every extension found, whatever its status. */
    public List<InstalledExtension> all() {
        return extensions.get();
    }

    /** The extensions that can be used. */
    public List<InstalledExtension> active() {
        return extensions.get().stream().filter(InstalledExtension::isActive).toList();
    }

    /** Finds an active extension by identifier. */
    public Optional<InstalledExtension> findActive(String id) {
        return extensions.get().stream()
                .filter(InstalledExtension::isActive)
                .filter(extension -> extension.key().equals(id))
                .findFirst();
    }
}
