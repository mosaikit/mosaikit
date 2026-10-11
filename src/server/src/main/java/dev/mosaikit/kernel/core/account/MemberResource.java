// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
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

/** The members of an organization (MK-017), managed by the platform administrators. */
@Path("/api/v1/organizations/{slug}/members")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@RolesAllowed(Roles.PLATFORM_ADMIN)
@Tag(name = "Organizations")
public class MemberResource {

    private final AccountService service;
    private final AuditLog audit;
    private final SecurityIdentity identity;

    public MemberResource(AccountService service, AuditLog audit, SecurityIdentity identity) {
        this.service = service;
        this.audit = audit;
        this.identity = identity;
    }

    @GET
    @Operation(summary = "List the members of an organization")
    public List<MemberView> list(@PathParam("slug") String slug) {
        return service.members(slug);
    }

    @PUT
    @Path("/{email}")
    @Operation(summary = "Add a person to an organization, or change their roles in it")
    public MemberView put(
            @PathParam("slug") String slug,
            @PathParam("email") @Email @Size(max = 254) String email,
            @Valid MemberRequest request) {
        MemberView member = service.putMember(slug, email, request);
        audit("organization.member.updated", slug, email, Map.of("roles", member.roles()));
        return member;
    }

    @DELETE
    @Path("/{email}")
    @Operation(summary = "Remove a person from an organization")
    public void remove(@PathParam("slug") String slug, @PathParam("email") String email) {
        service.removeMember(slug, email);
        audit("organization.member.removed", slug, email, Map.of());
    }

    private void audit(String action, String slug, String email, Map<String, ?> detail) {
        audit.append(
                identity.getPrincipal().getName(),
                Optional.empty(),
                action,
                slug + "/" + email,
                AuditEvent.Outcome.SUCCEEDED,
                detail);
    }
}
