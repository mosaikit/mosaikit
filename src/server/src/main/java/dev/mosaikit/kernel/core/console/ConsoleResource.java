// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.console;

import dev.mosaikit.kernel.core.security.Roles;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/** The console of the platform administrators (MK-072): the state of the installation at a glance. */
@Path("/api/v1/platform/console")
@Produces(MediaType.APPLICATION_JSON)
@RolesAllowed(Roles.PLATFORM_ADMIN)
@Tag(name = "Platform")
public class ConsoleResource {

    private final PlatformConsole console;

    public ConsoleResource(PlatformConsole console) {
        this.console = console;
    }

    @GET
    @Operation(
            summary = "Get the state of the installation for the console",
            description = "Organizations (active and suspended), people, active extensions, the metrics of the"
                    + " instance that answers, and the entries of the audit log of the platform refused or failed"
                    + " in the last 24 hours, such as refused sign-ins.")
    public ConsoleOverview overview() {
        return console.overview();
    }
}
