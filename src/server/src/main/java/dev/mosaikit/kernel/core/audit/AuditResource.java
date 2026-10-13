// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.BeanParam;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The audit log, for the platform administrators: the entries of the platform, and of every
 * organization (MK-015, MK-059).
 */
@Path("/api/v1/audit-events")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@RolesAllowed(Roles.PLATFORM_ADMIN)
@Tag(name = "Audit")
public class AuditResource {

    private final AuditLog log;
    private final SecurityIdentity identity;

    public AuditResource(AuditLog log, SecurityIdentity identity) {
        this.log = log;
        this.identity = identity;
    }

    @GET
    @Operation(summary = "List audit events, newest first: of the platform, of one organization, or of all")
    public List<AuditEventView> list(
            @QueryParam("organization") UUID organization,
            @QueryParam("platform") boolean platform,
            @BeanParam AuditFilter filter) {
        return log.search(filter.query(Optional.ofNullable(organization), platform)).stream()
                .map(AuditEventView::of)
                .toList();
    }

    @GET
    @Path("/verification")
    @Operation(summary = "Verify the chain of the platform, or of one organization, reporting the first altered entry")
    public AuditVerification verify(@QueryParam("organization") UUID organization) {
        return log.verify(Optional.ofNullable(organization));
    }

    @GET
    @Path("/retention")
    @Operation(summary = "Get the retention of the audit events of the platform")
    public AuditRetentionView retention() {
        return log.retention(Optional.empty());
    }

    @PUT
    @Path("/retention")
    @Operation(summary = "Set the retention of the audit events of the platform, never below the installation minimum")
    public AuditRetentionView changeRetention(@Valid @NotNull AuditRetentionView.Change change) {
        AuditRetentionView result = log.changeRetention(Optional.empty(), change.retentionDays());
        log.append(
                identity.getPrincipal().getName(),
                Optional.empty(),
                "audit.retention.changed",
                "platform",
                AuditEvent.Outcome.SUCCEEDED,
                Map.of("retentionDays", String.valueOf(change.retentionDays())));
        return result;
    }
}
