// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.quotas;

import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.OrganizationService;
import dev.mosaikit.kernel.core.quotas.QuotaAdministration.LimitRequest;
import dev.mosaikit.kernel.core.quotas.QuotaAdministration.QuotaView;
import dev.mosaikit.kernel.core.quotas.QuotaAdministration.UsageReport;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import java.util.List;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The quotas of an organization (MK-076): its administrators see the limit and consumption of every
 * measure, and the consumption by period and person; platform administrators see those of any
 * organization and set its limits over the defaults of the installation.
 */
@Path("/api/v1/organizations/{slug}/quotas")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Quotas")
public class QuotaResource {

    private final QuotaAdministration administration;
    private final OrganizationService organizations;
    private final SecurityIdentity identity;

    public QuotaResource(
            QuotaAdministration administration, OrganizationService organizations, SecurityIdentity identity) {
        this.administration = administration;
        this.organizations = organizations;
        this.identity = identity;
    }

    @GET
    @Operation(
            summary = "List the measures of the organization with their limit and consumption",
            description = "storage, then the measures of the active extensions: limit (null for none), source"
                    + " (organization, installation, none), the period of a counter and what was used in it,"
                    + " or what a gauge keeps now.")
    public List<QuotaView> list(@PathParam("slug") String slug) {
        return administration.list(readable(slug));
    }

    @GET
    @Path("/usage")
    @Operation(
            summary = "The consumption of the organization by measure and person",
            description = "The counters of a month (period, such as 2026-10; this month by default) and the gauges"
                    + " now, with the months that have consumption.")
    public UsageReport usage(@PathParam("slug") String slug, @QueryParam("period") String period) {
        return administration.usage(readable(slug), period);
    }

    @GET
    @Path("/{measure: .+}")
    @Operation(summary = "One measure of the organization with its limit and consumption")
    public QuotaView get(@PathParam("slug") String slug, @PathParam("measure") String measure) {
        return administration.get(readable(slug), measure);
    }

    @PUT
    @Path("/{measure: .+}")
    @Operation(
            summary = "Set the limit of a measure for the organization",
            description = "Platform administrators. {\"limit\": n}, in the unit of the measure (bytes for storage),"
                    + " per month for a counter; {\"limit\": null} for no limit, whatever the default.")
    public QuotaView set(@PathParam("slug") String slug, @PathParam("measure") String measure, LimitRequest request) {
        return administration.setLimit(platform(slug), measure, request, actor());
    }

    @DELETE
    @Path("/{measure: .+}")
    @Operation(
            summary = "Remove the limit of a measure set for the organization",
            description = "Platform administrators. The default of the installation applies again.")
    public QuotaView remove(@PathParam("slug") String slug, @PathParam("measure") String measure) {
        return administration.removeLimit(platform(slug), measure, actor());
    }

    private String actor() {
        return identity.getPrincipal().getName();
    }

    /** The organization, for a platform administrator or one of its administrators acting on it. */
    private UUID readable(String slug) {
        Organization organization = organizations.require(slug);
        if (identity.hasRole(Roles.PLATFORM_ADMIN)) {
            return organization.getId();
        }
        boolean administrator = identity.hasRole(Roles.ORGANIZATION_ADMIN)
                && RequestOrganization.of(identity)
                        .filter(organization.getId()::equals)
                        .isPresent();
        if (!administrator) {
            throw new ForbiddenOperationException("Only the administrators of the organization see its quotas.");
        }
        return organization.getId();
    }

    private UUID platform(String slug) {
        Organization organization = organizations.require(slug);
        if (!identity.hasRole(Roles.PLATFORM_ADMIN)) {
            throw new ForbiddenOperationException("Only platform administrators set the quotas of an organization.");
        }
        return organization.getId();
    }
}
