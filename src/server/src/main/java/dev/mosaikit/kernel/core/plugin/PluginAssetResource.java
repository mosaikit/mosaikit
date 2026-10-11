// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import dev.mosaikit.kernel.core.config.KernelConfig;
import jakarta.annotation.security.PermitAll;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.core.CacheControl;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * Serves the static web assets of active plugins. Assets are code, not data, so they are public;
 * the data they request is protected by the API.
 */
@Path("/api/v1/plugin-assets")
@Tag(name = "Plugins")
public class PluginAssetResource {

    private static final int MAX_AGE_SECONDS = 300;

    private final PluginRegistry registry;
    private final boolean watched;

    public PluginAssetResource(PluginRegistry registry, KernelConfig config) {
        this.registry = registry;
        // A watched directory changes while the shell runs: the browser asks every time.
        this.watched = config.plugins().watch();
    }

    /** URL of an asset of a plugin. */
    static String assetUrl(String pluginId, String relativePath) {
        return "/api/v1/plugin-assets/" + pluginId + "/" + relativePath;
    }

    @GET
    @Path("/{id}/{path: .+}")
    @PermitAll
    @Operation(summary = "Get a static asset of an active plugin")
    public Response asset(@PathParam("id") String id, @PathParam("path") String path) {
        var cache = new CacheControl();
        if (watched) {
            cache.setNoCache(true);
        } else {
            cache.setMaxAge(MAX_AGE_SECONDS);
        }
        return registry.findActive(id)
                .flatMap(plugin -> PluginAssets.resolve(plugin.directory(), path))
                .map(asset -> Response.ok(asset.file().toFile(), asset.mediaType())
                        .cacheControl(cache)
                        .header("X-Content-Type-Options", "nosniff")
                        // Isolated frontends run in sandboxed iframes with an opaque origin, which
                        // load their modules as cross-origin requests (MK-014).
                        .header("Access-Control-Allow-Origin", "*")
                        .build())
                .orElseGet(() -> Response.status(Response.Status.NOT_FOUND).build());
    }
}
