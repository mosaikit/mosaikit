// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web;

import dev.mosaikit.kernel.api.plugin.BackendEntry;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.plugin.InstalledPlugin;
import dev.mosaikit.kernel.core.plugin.PluginRegistry;
import io.quarkus.security.identity.SecurityIdentity;
import io.quarkus.vertx.http.runtime.security.QuarkusHttpUser;
import io.vertx.core.http.HttpHeaders;
import io.vertx.ext.web.Router;
import io.vertx.ext.web.RoutingContext;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Serves the API of a plugin ({@code /api/v1/p/<api>/}) only while the plugin is active. The code
 * of a plugin can stay built into the kernel after it was disabled, rolled back or removed, until
 * the next rebuild; its endpoints must not answer in the meantime. Paths that no active plugin
 * declares answer 404, as a problem detail.
 */
@ApplicationScoped
public class PluginApiGuard {

    static final String PREFIX = "/api/v1/p/";

    private static final String NOT_FOUND = """
            {"type":"about:blank","title":"Not Found","status":404,\
            "detail":"No active plugin provides this API."}""";

    private static final String NO_ORGANIZATION = """
            {"type":"about:blank","title":"Forbidden","status":403,\
            "detail":"Choose an organization: plugin APIs act on the data of one organization."}""";

    private final PluginRegistry registry;

    public PluginApiGuard(PluginRegistry registry) {
        this.registry = registry;
    }

    /**
     * After authentication (order -200) and the permission check (-100) of Quarkus, so that an
     * anonymous request is refused before it can learn which plugin APIs exist.
     */
    static final int ORDER = -50;

    void register(@Observes Router router) {
        router.route(PREFIX + "*").order(ORDER).handler(this::guard);
    }

    private void guard(RoutingContext context) {
        Optional<String> api = apiName(context.normalizedPath());
        if (api.isEmpty() || !activeApis().contains(api.get())) {
            problem(context, 404, NOT_FOUND);
            return;
        }
        // Every request to a plugin acts on one organization of the person (MK-017).
        SecurityIdentity identity = context.user() instanceof QuarkusHttpUser user ? user.getSecurityIdentity() : null;
        if (RequestOrganization.of(identity).isEmpty()) {
            problem(context, 403, NO_ORGANIZATION);
            return;
        }
        context.next();
    }

    private static void problem(RoutingContext context, int status, String body) {
        context.response()
                .setStatusCode(status)
                .putHeader(HttpHeaders.CONTENT_TYPE, "application/problem+json")
                .end(body);
    }

    private Set<String> activeApis() {
        return registry.active().stream()
                .map(InstalledPlugin::manifest)
                .flatMap(Optional::stream)
                .flatMap(manifest -> manifest.backend().stream())
                .map(BackendEntry::api)
                .collect(Collectors.toUnmodifiableSet());
    }

    /** The API name of a path under {@link #PREFIX}, if it has one. */
    static Optional<String> apiName(String path) {
        if (path == null || !path.startsWith(PREFIX)) {
            return Optional.empty();
        }
        String rest = path.substring(PREFIX.length());
        int slash = rest.indexOf('/');
        String name = slash < 0 ? rest : rest.substring(0, slash);
        return name.isEmpty() ? Optional.empty() : Optional.of(name);
    }
}
