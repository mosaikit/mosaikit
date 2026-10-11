// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import dev.mosaikit.kernel.core.account.AccountService;
import dev.mosaikit.kernel.core.account.MemberRequest;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriBuilder;
import jakarta.ws.rs.core.UriInfo;
import java.net.URI;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/** Management of organizations by the platform operator. */
@Path("/api/v1/organizations")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Tag(name = "Organizations")
@RolesAllowed(Roles.PLATFORM_ADMIN)
public class OrganizationResource {

    private final OrganizationService service;
    private final AccountService accounts;
    private final KernelConfig config;
    private final AuditLog audit;
    private final SecurityIdentity identity;

    public OrganizationResource(
            OrganizationService service,
            AccountService accounts,
            KernelConfig config,
            AuditLog audit,
            SecurityIdentity identity) {
        this.service = service;
        this.accounts = accounts;
        this.config = config;
        this.audit = audit;
        this.identity = identity;
    }

    @GET
    @Operation(summary = "List organizations")
    public List<OrganizationView> list() {
        return service.list();
    }

    @GET
    @Path("/{slug}")
    @Operation(summary = "Get an organization")
    public OrganizationView get(@PathParam("slug") String slug) {
        return service.get(slug);
    }

    @PUT
    @Path("/{slug}/identity")
    @Operation(summary = "Set the Keycloak realm and the email domains of an organization")
    public OrganizationView updateIdentity(
            @PathParam("slug") String slug, @Valid @NotNull UpdateIdentityRequest request) {
        OrganizationView updated = service.updateIdentity(slug, request);
        audit.append(
                identity.getPrincipal().getName(),
                Optional.of(updated.id()),
                "organization.identity.updated",
                slug,
                AuditEvent.Outcome.SUCCEEDED,
                Map.of("realm", String.valueOf(request.realm())));
        return updated;
    }

    @POST
    @Operation(summary = "Create an organization, and its Keycloak realm when federation is asked")
    public Response create(@Valid @NotNull CreateOrganizationRequest request, @Context UriInfo uri) {
        OrganizationView created = service.create(request, redirectUris(request.slug(), uri.getBaseUri()));
        audit.append(
                identity.getPrincipal().getName(),
                Optional.of(created.id()),
                "organization.created",
                created.slug(),
                AuditEvent.Outcome.SUCCEEDED,
                Map.of("federation", request.federation() != null));
        if (request.federation() != null && request.federation().administrator() != null) {
            // The first manager becomes a member now, so that an account the person already has
            // elsewhere is linked at their first sign-in through the realm (MK-017).
            var administrator = request.federation().administrator();
            accounts.putMember(
                    created.slug(),
                    administrator.email(),
                    new MemberRequest(
                            Set.of(Roles.ORGANIZATION_ADMIN, Roles.ORGANIZATION_USER),
                            administrator.firstName() + " " + administrator.lastName()));
        }
        return Response.created(
                        UriBuilder.fromPath("/api/v1/organizations/{slug}").build(created.slug()))
                .entity(created)
                .build();
    }

    /**
     * Addresses of the kernel UI that the realm of a new organization accepts: the address of this
     * request and, with {@code mosaikit.identity.domain}, the sub-domain of the organization.
     */
    private List<String> redirectUris(String slug, URI base) {
        String port = base.getPort() < 0 ? "" : ":" + base.getPort();
        List<String> uris = new ArrayList<>();
        uris.add(base.getScheme() + "://" + base.getHost() + port + "/*");
        config.identity()
                .domain()
                .ifPresent(domain -> uris.add(
                        base.getScheme() + "://" + slug.toLowerCase(Locale.ROOT) + "." + domain + port + "/*"));
        return uris;
    }
}
