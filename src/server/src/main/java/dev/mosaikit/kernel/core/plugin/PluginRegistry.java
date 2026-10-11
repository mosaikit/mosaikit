// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

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
 * The plugins of this installation. They are read once at start: installing or removing a plugin
 * takes effect at the next restart (see ADR-0004).
 */
@ApplicationScoped
public class PluginRegistry {

    private static final Logger LOG = Logger.getLogger(PluginRegistry.class);

    private final Path directory;
    private final Optional<Path> providersDirectory;
    private final Path packagesDirectory;
    private final Version kernelVersion;
    private final Path trustedKeysDirectory;
    private final String signatures;
    private final Event<PluginsLoaded> loaded;
    private final AtomicReference<List<InstalledPlugin>> plugins = new AtomicReference<>(List.of());
    private final AtomicLong revision = new AtomicLong();

    public PluginRegistry(KernelConfig config, KernelVersion kernelVersion, Event<PluginsLoaded> loaded) {
        this.directory = config.plugins().directory().toAbsolutePath().normalize();
        this.providersDirectory = config.plugins()
                .providersDirectory()
                .map(path -> path.toAbsolutePath().normalize());
        this.packagesDirectory = config.plugins()
                .packagesDirectory()
                .orElseGet(() -> directory.resolve(".packages"))
                .toAbsolutePath()
                .normalize();
        this.kernelVersion = kernelVersion.get();
        this.trustedKeysDirectory =
                config.plugins().trustedKeysDirectory().toAbsolutePath().normalize();
        this.signatures = config.plugins().signatures();
        this.loaded = loaded;
    }

    void onStart(@Observes StartupEvent event) {
        reload();
        loaded.fire(new PluginsLoaded(active()));
    }

    /** Reads the installation directory again. */
    public void reload() {
        BackendCheck backendCheck = providersDirectory
                .map(providers -> BackendCheck.loadedBy(
                        ProviderState.read(providers), ProviderState.read(providers, ProviderState.REJECTED_FILE)))
                .orElseGet(BackendCheck::notLoaded);
        PackageTrust trust = PackageTrust.read(trustedKeysDirectory, signatures);
        List<InstalledPlugin> found =
                new PluginCatalog(kernelVersion, backendCheck, trust).scan(directory, packagesDirectory);
        plugins.set(found);
        revision.incrementAndGet();
        LOG.infof("Plugins in %s: %d found, %d active", directory, found.size(), active().size());
        found.stream()
                .filter(plugin -> !plugin.isActive())
                .forEach(plugin -> LOG.warnf("Plugin %s is %s: %s", plugin.key(), plugin.status(), plugin.problems()));
    }

    /** How many times the installation directory was read: changes after every {@link #reload()}. */
    public long revision() {
        return revision.get();
    }

    /** Directory of the installed plugins. */
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

    /** Every plugin found, whatever its status. */
    public List<InstalledPlugin> all() {
        return plugins.get();
    }

    /** The plugins that can be used. */
    public List<InstalledPlugin> active() {
        return plugins.get().stream().filter(InstalledPlugin::isActive).toList();
    }

    /** Finds an active plugin by identifier. */
    public Optional<InstalledPlugin> findActive(String id) {
        return plugins.get().stream()
                .filter(InstalledPlugin::isActive)
                .filter(plugin -> plugin.key().equals(id))
                .findFirst();
    }
}
