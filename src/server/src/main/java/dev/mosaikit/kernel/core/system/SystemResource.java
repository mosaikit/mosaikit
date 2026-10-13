// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.system;

import dev.mosaikit.kernel.api.extension.ThemeEntry;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.extension.ExtensionAssetResource;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
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
    private final ExtensionRegistry extensions;
    private final String theme;
    private final long rememberDays;

    public SystemResource(KernelVersion kernelVersion, ExtensionRegistry extensions, KernelConfig config) {
        this.kernelVersion = kernelVersion;
        this.extensions = extensions;
        this.theme = config.ui().theme();
        this.rememberDays = config.accounts().rememberFor().toDays();
    }

    @GET
    @Path("/info")
    @PermitAll
    @Operation(summary = "Get product name and logo, kernel version, number of active extensions and theme")
    public SystemInfo info() {
        // The theme of the installation names the product and brings its logo (MK-052); a person who
        // chooses another theme keeps them, since they are the installation's, not a look.
        var branding = extensions
                .findActive(theme)
                .flatMap(extension -> extension.manifest())
                .flatMap(manifest -> manifest.theme());
        String product = branding.map(ThemeEntry::product).orElse(PRODUCT_NAME);
        String logo = branding.map(ThemeEntry::logo).map(this::themeAsset).orElse(null);
        String logoDark =
                branding.map(ThemeEntry::logoDark).map(this::themeAsset).orElse(logo);
        return new SystemInfo(
                product,
                kernelVersion.get().toString(),
                extensions.active().size(),
                theme,
                rememberDays,
                logo,
                logoDark);
    }

    private String themeAsset(String path) {
        return ExtensionAssetResource.assetUrl(theme, path);
    }

    @GET
    @Path("/themes")
    @PermitAll
    @Operation(summary = "List the themes of the active theme extensions (MK-028)")
    public List<ThemeView> themes() {
        return extensions.active().stream()
                .flatMap(extension -> extension.manifest().stream())
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
