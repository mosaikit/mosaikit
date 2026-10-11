// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.apps;

import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.plugin.PluginRegistry;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.Priority;
import jakarta.inject.Inject;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Refuses the API and the documents of a plugin to the people of an organization that turned all
 * its apps off (MK-030): {@code /api/v1/p/<api>/…} and {@code /api/v1/data/<plugin id>/…}.
 */
@Provider
@Priority(Priorities.AUTHORIZATION + 10)
public class AppAccessFilter implements ContainerRequestFilter {

    @Inject
    SecurityIdentity identity;

    @Inject
    AppSettings settings;

    @Inject
    PluginRegistry registry;

    @Override
    public void filter(ContainerRequestContext request) {
        String path = request.getUriInfo().getPath();
        Optional<UUID> organization = RequestOrganization.of(identity);
        if (organization.isEmpty()) {
            return;
        }
        pluginOf(path)
                .filter(plugin -> settings.isOff(organization.get(), plugin))
                .ifPresent(plugin -> request.abortWith(Response.status(Response.Status.FORBIDDEN)
                        .type("application/problem+json")
                        .entity(Map.of(
                                "type", "about:blank",
                                "title", "Forbidden",
                                "status", 403,
                                "detail", "This app is turned off for your organization."))
                        .build()));
    }

    private Optional<String> pluginOf(String path) {
        String clean = path.startsWith("/") ? path.substring(1) : path;
        String[] parts = clean.split("/");
        if (parts.length >= 4 && "api".equals(parts[0]) && "v1".equals(parts[1])) {
            if ("data".equals(parts[2])) {
                return Optional.of(parts[3]);
            }
            if ("p".equals(parts[2])) {
                String api = parts[3];
                return registry.active().stream()
                        .flatMap(plugin -> plugin.manifest().stream())
                        .filter(manifest -> manifest.backend()
                                .filter(backend -> api.equals(backend.api()))
                                .isPresent())
                        .map(manifest -> manifest.id())
                        .findFirst();
            }
        }
        return Optional.empty();
    }
}
