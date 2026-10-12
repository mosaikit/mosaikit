// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import dev.mosaikit.kernel.core.apps.AppSettings;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/** Installed extensions: full view for the operator, frontend view for the shell. */
@Path("/api/v1")
@Produces(MediaType.APPLICATION_JSON)
@Tag(name = "Extensions")
public class ExtensionResource {

    private final AppSettings apps;
    private final SecurityIdentity identity;
    private final ExtensionRegistry registry;
    private final boolean isolateUnverified;
    private final boolean watched;

    public ExtensionResource(
            ExtensionRegistry registry, KernelConfig config, AppSettings apps, SecurityIdentity identity) {
        this.registry = registry;
        this.apps = apps;
        this.identity = identity;
        this.watched = config.extensions().watch();
        this.isolateUnverified =
                FrontendExtensionView.isolatesUnverified(config.extensions().unverifiedFrontends());
    }

    @GET
    @Path("/extensions")
    @RolesAllowed(Roles.PLATFORM_ADMIN)
    @Operation(summary = "List installed extensions with their status")
    public List<ExtensionView> list() {
        return registry.all().stream().map(ExtensionView::of).toList();
    }

    @GET
    @Path("/shell/extensions")
    @Authenticated
    @Operation(
            summary = "List the frontends the shell must load",
            description = "Not those of the extensions turned off for the organization of the request (MK-030), so"
                    + " that what they contribute to other extensions is missing too (MK-035).")
    public List<FrontendExtensionView> shellExtensions() {
        Optional<UUID> organization = RequestOrganization.of(identity);
        return registry.active().stream()
                .filter(extension ->
                        organization.map(id -> !apps.isOff(id, extension.key())).orElse(true))
                .flatMap(extension -> extension.manifest().stream()
                        .flatMap(manifest -> manifest.frontend().stream()
                                .map(frontend -> FrontendExtensionView.of(
                                        manifest, frontend, isolateUnverified && !extension.isVerified()))))
                .toList();
    }

    @GET
    @Path("/shell/extensions/revision")
    @Authenticated
    @Operation(
            summary = "Get the revision of the installed extensions, when the extensions directory is watched",
            description = "404 when it is not watched (mosaikit.extensions.watch). The shell reloads its page when"
                    + " the revision changes.")
    public Response revision() {
        if (!watched) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        return Response.ok(Map.of("revision", registry.revision())).build();
    }
}
