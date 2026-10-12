// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

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
 * Serves the static web assets of active extensions. Assets are code, not data, so they are public;
 * the data they request is protected by the API.
 */
@Path("/api/v1/extension-assets")
@Tag(name = "Extensions")
public class ExtensionAssetResource {

    private static final int MAX_AGE_SECONDS = 300;

    private final ExtensionRegistry registry;
    private final boolean watched;

    public ExtensionAssetResource(ExtensionRegistry registry, KernelConfig config) {
        this.registry = registry;
        // A watched directory changes while the shell runs: the browser asks every time.
        this.watched = config.extensions().watch();
    }

    /** URL of an asset of an extension. */
    static String assetUrl(String extensionId, String relativePath) {
        return "/api/v1/extension-assets/" + extensionId + "/" + relativePath;
    }

    @GET
    @Path("/{id}/{path: .+}")
    @PermitAll
    @Operation(summary = "Get a static asset of an active extension")
    public Response asset(@PathParam("id") String id, @PathParam("path") String path) {
        var cache = new CacheControl();
        if (watched) {
            cache.setNoCache(true);
        } else {
            cache.setMaxAge(MAX_AGE_SECONDS);
        }
        return registry.findActive(id)
                .flatMap(extension -> ExtensionAssets.resolve(extension.directory(), path))
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
