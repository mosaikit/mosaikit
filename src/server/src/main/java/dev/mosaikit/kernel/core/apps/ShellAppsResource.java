// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.apps;

import dev.mosaikit.kernel.core.identity.RequestOrganization;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/** The apps of the app bar of the signed-in person, as the organization shows them (MK-030). */
@Path("/api/v1/shell/apps")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Apps")
public class ShellAppsResource {

    private final AppSettings settings;
    private final SecurityIdentity identity;

    public ShellAppsResource(AppSettings settings, SecurityIdentity identity) {
        this.settings = settings;
        this.identity = identity;
    }

    @GET
    @Operation(summary = "Get the apps the signed-in person sees in the app bar, in order")
    public List<ShellApp> forShell() {
        return settings.forPerson(RequestOrganization.of(identity), identity.getRoles());
    }
}
