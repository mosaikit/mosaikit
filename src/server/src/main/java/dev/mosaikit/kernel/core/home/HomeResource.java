// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.home;

import dev.mosaikit.kernel.api.extension.FrontendIsolation;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.extension.ContractChecks;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.FrontendExtensionView;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import jakarta.annotation.security.PermitAll;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/** The home page of visitors without an account (MK-101): the widgets that extensions declare public. */
@Path("/api/v1/shell/home")
@Produces(MediaType.APPLICATION_JSON)
@Tag(name = "Extensions")
public class HomeResource {

    private final ExtensionRegistry registry;
    private final boolean isolateUnverified;

    public HomeResource(ExtensionRegistry registry, KernelConfig config) {
        this.registry = registry;
        this.isolateUnverified =
                FrontendExtensionView.isolatesUnverified(config.extensions().unverifiedFrontends());
    }

    @GET
    @Path("/public")
    @PermitAll
    @Operation(
            summary = "List the frontends of the widgets that anonymous visitors see on the home page",
            description = "Only the active extensions that contribute a home.widget declared public, with only those"
                    + " contributions, and only the frontends that run in the page: an isolated frontend has no"
                    + " widget on the home page. No organization applies: the installation decides.")
    public List<FrontendExtensionView> publicWidgets() {
        return registry.active().stream()
                .flatMap(extension -> extension.manifest().stream()
                        .flatMap(manifest -> manifest.frontend().stream()
                                .map(frontend -> FrontendExtensionView.of(
                                        manifest,
                                        frontend,
                                        isolates(extension),
                                        contribution -> HomeWidgets.isWidget(contribution)
                                                && HomeWidgets.isPublic(contribution)
                                                && ContractChecks.matches(contribution, List.of())))))
                .filter(view -> !view.contributions().isEmpty())
                .filter(view -> FrontendIsolation.MODULE.value().equals(view.isolation()))
                .map(view -> new FrontendExtensionView(
                        view.id(),
                        view.version(),
                        view.entry(),
                        view.isolation(),
                        // A visitor's page calls nothing of the extension on its behalf.
                        new FrontendExtensionView.BridgeView(List.of(), List.of(), List.of(), null, null),
                        view.contributions(),
                        List.of()))
                .toList();
    }

    private boolean isolates(InstalledExtension extension) {
        return isolateUnverified && !extension.isVerified();
    }
}
