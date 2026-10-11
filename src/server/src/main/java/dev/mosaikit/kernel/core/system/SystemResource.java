// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.system;

import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.plugin.PluginRegistry;
import jakarta.annotation.security.PermitAll;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/** Public information used by the shell before sign-in. */
@Path("/api/v1/system")
@Produces(MediaType.APPLICATION_JSON)
@Tag(name = "System")
public class SystemResource {

    private static final String PRODUCT_NAME = "Mosaikit";

    private final KernelVersion kernelVersion;
    private final PluginRegistry plugins;
    private final String theme;
    private final long rememberDays;

    public SystemResource(KernelVersion kernelVersion, PluginRegistry plugins, KernelConfig config) {
        this.kernelVersion = kernelVersion;
        this.plugins = plugins;
        this.theme = config.ui().theme();
        this.rememberDays = config.accounts().rememberFor().toDays();
    }

    @GET
    @Path("/info")
    @PermitAll
    @Operation(summary = "Get product name, kernel version, number of active plugins and theme")
    public SystemInfo info() {
        return new SystemInfo(
                PRODUCT_NAME, kernelVersion.get().toString(), plugins.active().size(), theme, rememberDays);
    }

    @GET
    @Path("/themes")
    @PermitAll
    @Operation(summary = "List the themes of the active theme plugins (MK-028)")
    public List<ThemeView> themes() {
        return plugins.active().stream()
                .flatMap(plugin -> plugin.manifest().stream())
                .flatMap(manifest -> manifest.theme().stream()
                        .map(theme -> new ThemeView(
                                manifest.id(),
                                theme.title(),
                                theme.font(),
                                theme.radius(),
                                theme.light(),
                                theme.dark())))
                .toList();
    }
}
