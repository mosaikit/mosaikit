// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.marketplace;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;
import java.util.Optional;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/** The marketplace, for the platform administrators (MK-022). */
@Path("/api/v1")
@Produces(MediaType.APPLICATION_JSON)
@RolesAllowed(Roles.PLATFORM_ADMIN)
@Tag(name = "Marketplace")
public class MarketplaceResource {

    /** A package of a catalog to install. */
    public record InstallationRequest(
            @NotBlank String source,
            @NotBlank String id,
            @NotBlank String version) {}

    private final Marketplace marketplace;
    private final AuditLog audit;
    private final SecurityIdentity identity;

    public MarketplaceResource(Marketplace marketplace, AuditLog audit, SecurityIdentity identity) {
        this.marketplace = marketplace;
        this.audit = audit;
        this.identity = identity;
    }

    @GET
    @Path("/marketplace")
    @Operation(summary = "List the plugins that the catalogs offer")
    public CatalogView catalog() {
        return marketplace.catalog();
    }

    @POST
    @Path("/marketplace/installations")
    @Consumes(MediaType.APPLICATION_JSON)
    @Operation(
            summary = "Install a plugin from a catalog",
            description = "The package is placed in the plugins directory and used at the next start.")
    public Response install(@Valid @NotNull InstallationRequest request) {
        Installation installation = marketplace.install(request.source(), request.id(), request.version());
        auditInstallation(installation, request.source());
        return Response.accepted(installation).build();
    }

    @POST
    @Path("/plugins/packages")
    @Consumes({"application/zip", MediaType.APPLICATION_OCTET_STREAM})
    @Operation(
            summary = "Install an uploaded plugin package",
            description = "For installations without network: the package must be signed by a trusted publisher.")
    public Response upload(byte[] body) {
        Installation installation = marketplace.upload(body);
        auditInstallation(installation, "upload");
        return Response.accepted(installation).build();
    }

    private void auditInstallation(Installation installation, String source) {
        audit.append(
                identity.getPrincipal().getName(),
                Optional.empty(),
                "plugin.installed",
                installation.id() + " " + installation.version(),
                AuditEvent.Outcome.SUCCEEDED,
                Map.of(
                        "source", source,
                        "file", installation.file(),
                        "publisherKey", installation.publisherKey(),
                        "replaced", String.valueOf(installation.replaced())));
    }
}
