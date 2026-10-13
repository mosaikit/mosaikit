// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web.csp;

import dev.mosaikit.kernel.core.security.Roles;
import dev.mosaikit.kernel.core.web.csp.OriginAdministration.OriginRequest;
import dev.mosaikit.kernel.core.web.csp.OriginAdministration.OriginView;
import dev.mosaikit.kernel.core.web.csp.OriginAdministration.PolicyView;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The external origins of the content security policy of the shell (MK-128), for platform
 * administrators only: an administrator of an organization, or an extension, cannot widen it.
 */
@Path("/api/v1/platform/content-security-policy")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@RolesAllowed(Roles.PLATFORM_ADMIN)
@Tag(name = "Platform")
public class ContentSecurityPolicyResource {

    private final OriginAdministration administration;
    private final ContentSecurityPolicy policy;
    private final SecurityIdentity identity;

    public ContentSecurityPolicyResource(
            OriginAdministration administration, ContentSecurityPolicy policy, SecurityIdentity identity) {
        this.administration = administration;
        this.policy = policy;
        this.identity = identity;
    }

    @GET
    @Operation(summary = "The external origins that the browser may contact, and the policy the kernel sends")
    public PolicyView get() {
        return new PolicyView(policy.enabled(), policy.current(), administration.list());
    }

    @POST
    @Path("/origins")
    @Operation(
            summary = "Allow an external origin for images, data and tiles",
            description = "origin: scheme://host[:port], with https, wss, http or ws. Added to connect-src and"
                    + " img-src of the policy (audited).")
    public Response add(OriginRequest request) {
        OriginView added = administration.add(request, identity.getPrincipal().getName());
        policy.refresh();
        return Response.status(Response.Status.CREATED).entity(added).build();
    }

    @DELETE
    @Path("/origins")
    @Operation(summary = "Stop allowing an external origin that an administrator added (audited)")
    public Response remove(@QueryParam("origin") String origin) {
        administration.remove(origin, identity.getPrincipal().getName());
        policy.refresh();
        return Response.noContent().build();
    }
}
