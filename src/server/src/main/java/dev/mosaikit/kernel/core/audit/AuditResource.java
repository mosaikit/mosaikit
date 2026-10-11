// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import dev.mosaikit.kernel.core.security.Roles;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.DefaultValue;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/** The audit log, for the platform administrators. */
@Path("/api/v1/audit-events")
@Produces(MediaType.APPLICATION_JSON)
@RolesAllowed(Roles.PLATFORM_ADMIN)
@Tag(name = "Audit")
public class AuditResource {

    private final AuditLog log;

    public AuditResource(AuditLog log) {
        this.log = log;
    }

    @GET
    @Operation(summary = "List the latest audit events, newest first")
    public List<AuditEventView> list(
            @QueryParam("organization") UUID organization, @QueryParam("limit") @DefaultValue("100") int limit) {
        return log.latest(Optional.ofNullable(organization), limit).stream()
                .map(AuditEventView::of)
                .toList();
    }
}
