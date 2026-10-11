// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.apps;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.OrganizationService;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
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
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The apps of the app bar of an organization (MK-030), set by the administrators of the organization
 * or by platform administrators.
 */
@Path("/api/v1/organizations/{slug}/apps")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Apps")
public class AppSettingsResource {

    private final AppSettings settings;
    private final OrganizationService organizations;
    private final SecurityIdentity identity;
    private final AuditLog audit;

    public AppSettingsResource(
            AppSettings settings, OrganizationService organizations, SecurityIdentity identity, AuditLog audit) {
        this.settings = settings;
        this.organizations = organizations;
        this.identity = identity;
        this.audit = audit;
    }

    @GET
    @Operation(summary = "Get the apps of the app bar of an organization, with their settings")
    public List<AppView> list(@PathParam("slug") String slug) {
        return settings.list(managed(slug).getId());
    }

    @PUT
    @Operation(
            summary = "Set the apps of the app bar of an organization",
            description = "The order of the list is the order of the app bar; an empty list goes back to the defaults.")
    public List<AppView> change(@PathParam("slug") String slug, @Valid @NotNull List<AppView> apps) {
        Organization organization = managed(slug);
        List<AppView> result = settings.change(organization.getId(), apps);
        audit.append(
                identity.getPrincipal().getName(),
                Optional.of(organization.getId()),
                "organization.apps.changed",
                slug,
                AuditEvent.Outcome.SUCCEEDED,
                Map.of(
                        "off",
                        apps.stream()
                                .filter(app -> !app.enabled())
                                .map(app -> app.pluginId() + "/" + app.appId())
                                .toList()));
        return result;
    }

    /** The organization, when the person manages it: its administrator, or a platform administrator. */
    private Organization managed(String slug) {
        Organization organization = organizations.require(slug);
        boolean platform = identity.hasRole(Roles.PLATFORM_ADMIN);
        boolean manager = identity.hasRole(Roles.ORGANIZATION_ADMIN)
                && RequestOrganization.of(identity)
                        .filter(organization.getId()::equals)
                        .isPresent();
        if (!platform && !manager) {
            throw new ForbiddenOperationException("Only the administrators of the organization manage its apps.");
        }
        return organization;
    }
}
