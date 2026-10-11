// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import dev.mosaikit.kernel.core.plugin.InstalledPlugin;
import dev.mosaikit.kernel.core.plugin.PluginRegistry;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Supplier;

/** The tools that the active plugins offer to assistants and MCP clients (MK-015). */
@ApplicationScoped
public class ActionCatalog {

    private final Supplier<List<InstalledPlugin>> plugins;

    @Inject
    public ActionCatalog(PluginRegistry registry) {
        this(registry::active);
    }

    /** A catalog of the given plugins, those that are active. */
    public ActionCatalog(Supplier<List<InstalledPlugin>> plugins) {
        this.plugins = Objects.requireNonNull(plugins, "plugins");
    }

    /** Every tool, by plugin and in the order of the manifests. */
    public List<AiTool> tools() {
        return plugins.get().stream()
                .filter(InstalledPlugin::isActive)
                .flatMap(plugin -> plugin.manifest().stream())
                .flatMap(manifest -> manifest.backend().stream()
                        .flatMap(backend -> manifest.actions().stream()
                                .map(action -> AiTool.of(manifest.id(), backend.api(), action))))
                .toList();
    }

    /** The tool of that name, if an active plugin offers it. */
    public Optional<AiTool> find(String name) {
        return tools().stream().filter(tool -> tool.name().equals(name)).findFirst();
    }
}
