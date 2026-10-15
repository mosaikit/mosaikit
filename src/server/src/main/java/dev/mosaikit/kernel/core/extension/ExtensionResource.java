// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.core.apps.AppSettings;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.presence.KernelExtensionPresence;
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
    private final KernelExtensionPresence presence;

    public ExtensionResource(
            ExtensionRegistry registry,
            KernelConfig config,
            AppSettings apps,
            SecurityIdentity identity,
            KernelExtensionPresence presence) {
        this.registry = registry;
        this.presence = presence;
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
        List<InstalledExtension> shown = registry.active().stream()
                .filter(extension ->
                        organization.map(id -> !apps.isOff(id, extension.key())).orElse(true))
                .toList();
        // A contribution that does not match the schema of the point it targets never reaches its owner,
        // such as one installed before the owner (MK-134).
        List<ExtensionManifest> owners = shown.stream()
                .flatMap(extension -> extension.manifest().stream())
                .filter(manifest -> !manifest.extensionPoints().isEmpty())
                .toList();
        return shown.stream()
                .flatMap(extension -> extension.manifest().stream()
                        .flatMap(manifest -> manifest.frontend().stream()
                                .map(frontend -> FrontendExtensionView.of(
                                        manifest,
                                        frontend,
                                        isolateUnverified && !extension.isVerified(),
                                        contribution -> ContractChecks.matches(contribution, owners)))))
                .toList();
    }

    @GET
    @Path("/shell/extensions/active")
    @Authenticated
    @Operation(
            summary = "List the extensions active in the organization of the request, with their version",
            description = "Every extension, with or without a frontend, that is installed, compatible and not turned"
                    + " off for the organization (MK-133); in the installation without an organization. The shell"
                    + " gives it to the frontends of extensions and keeps it current through the real-time topic"
                    + " 'extensions'.")
    public List<KernelExtensionPresence.Active> activeExtensions() {
        return presence.activeIn(RequestOrganization.of(identity));
    }

    @GET
    @Path("/shell/extensions/revision")
    @Authenticated
    @Operation(
            summary = "Get the revision of the installed extensions, when the extensions directory is watched",
            description = "204 without a body when it is not watched (mosaikit.extensions.watch), so that the"
                    + " shell asking at each page load fails nothing. The shell reloads its page when the revision"
                    + " changes.")
    public Response revision() {
        if (!watched) {
            return Response.noContent().build();
        }
        return Response.ok(Map.of("revision", registry.revision())).build();
    }
}
