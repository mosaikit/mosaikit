// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.OrganizationService;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.BeanParam;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The audit log of an organization, for its administrators signed in to it and for platform
 * administrators (MK-059): its entries only, their verification and their retention.
 */
@Path("/api/v1/organizations/{slug}/audit-events")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Audit")
public class OrganizationAuditResource {

    private final AuditLog log;
    private final OrganizationService organizations;
    private final SecurityIdentity identity;

    public OrganizationAuditResource(AuditLog log, OrganizationService organizations, SecurityIdentity identity) {
        this.log = log;
        this.organizations = organizations;
        this.identity = identity;
    }

    @GET
    @Operation(summary = "List the audit events of an organization, newest first, with filters")
    public List<AuditEventView> list(@PathParam("slug") String slug, @BeanParam AuditFilter filter) {
        Optional<UUID> organization = Optional.of(managed(slug));
        return log.search(filter.query(organization, false)).stream()
                .map(AuditEventView::of)
                .toList();
    }

    @GET
    @Path("/verification")
    @Operation(summary = "Verify the chain of the audit events of an organization, reporting the first altered entry")
    public AuditVerification verify(@PathParam("slug") String slug) {
        return log.verify(Optional.of(managed(slug)));
    }

    @GET
    @Path("/retention")
    @Operation(summary = "Get the retention of the audit events of an organization")
    public AuditRetentionView retention(@PathParam("slug") String slug) {
        return log.retention(Optional.of(managed(slug)));
    }

    @PUT
    @Path("/retention")
    @Operation(
            summary = "Set the retention of the audit events of an organization, never below the installation minimum")
    public AuditRetentionView changeRetention(
            @PathParam("slug") String slug, @Valid @NotNull AuditRetentionView.Change change) {
        UUID organization = managed(slug);
        AuditRetentionView result = log.changeRetention(Optional.of(organization), change.retentionDays());
        log.append(
                identity.getPrincipal().getName(),
                Optional.of(organization),
                "audit.retention.changed",
                slug,
                AuditEvent.Outcome.SUCCEEDED,
                Map.of("retentionDays", String.valueOf(change.retentionDays())));
        return result;
    }

    private UUID managed(String slug) {
        Organization organization = organizations.require(slug);
        boolean platform = identity.hasRole(Roles.PLATFORM_ADMIN);
        boolean manager = identity.hasRole(Roles.ORGANIZATION_ADMIN)
                && RequestOrganization.of(identity)
                        .filter(organization.getId()::equals)
                        .isPresent();
        if (!platform && !manager) {
            throw new ForbiddenOperationException(
                    "Only the administrators of the organization, signed in to it, read its audit log.");
        }
        return organization.getId();
    }
}
