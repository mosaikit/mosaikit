// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.settings;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.validation.Valid;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.Map;
import java.util.Optional;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/** The settings of the platform, for platform administrators. */
@Path("/api/v1/platform/settings")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@RolesAllowed(Roles.PLATFORM_ADMIN)
@Tag(name = "Platform")
public class PlatformSettingsResource {

    private final PlatformSettingsService service;
    private final SecurityIdentity identity;
    private final AuditLog audit;

    public PlatformSettingsResource(PlatformSettingsService service, SecurityIdentity identity, AuditLog audit) {
        this.service = service;
        this.identity = identity;
        this.audit = audit;
    }

    @GET
    @Operation(summary = "Get the settings of the platform")
    public PlatformSettingsView get() {
        return service.get();
    }

    @PUT
    @Operation(summary = "Change the settings of the platform", description = "For example turn self-registration off.")
    public PlatformSettingsView change(@Valid PlatformSettingsView changed) {
        String administrator = identity.getPrincipal().getName();
        PlatformSettingsView result = service.change(changed, administrator);
        audit.append(
                administrator,
                Optional.empty(),
                "platform.settings.changed",
                "platform",
                AuditEvent.Outcome.SUCCEEDED,
                Map.of("registration", result.registration()));
        return result;
    }
}
