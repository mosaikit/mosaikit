// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.OrganizationService;
import dev.mosaikit.kernel.core.permissions.PermissionAdministration;
import dev.mosaikit.kernel.core.security.Roles;
import dev.mosaikit.kernel.core.teams.TeamMember;
import dev.mosaikit.kernel.core.teams.TeamService;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.transaction.Transactional;
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
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The members of an organization (MK-017), managed by the platform administrators: they add people,
 * change their roles and remove them. The administrators of the organization, signed in to it, list
 * its members and give profile and teams to those who are already members (MK-056).
 */
@Path("/api/v1/organizations/{slug}/members")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Organizations")
public class MemberResource {

    private final AccountService service;
    private final OrganizationService organizations;
    private final PermissionAdministration permissions;
    private final TeamService teams;
    private final AuditLog audit;
    private final SecurityIdentity identity;

    public MemberResource(
            AccountService service,
            OrganizationService organizations,
            PermissionAdministration permissions,
            TeamService teams,
            AuditLog audit,
            SecurityIdentity identity) {
        this.service = service;
        this.organizations = organizations;
        this.permissions = permissions;
        this.teams = teams;
        this.audit = audit;
        this.identity = identity;
    }

    @GET
    @Operation(summary = "List the members of an organization")
    public List<MemberView> list(@PathParam("slug") String slug) {
        managed(slug);
        return service.members(slug);
    }

    @PUT
    @Path("/{email}")
    @Transactional
    @Operation(
            summary = "Add a person to an organization, or change their roles in it",
            description = "Platform administrators add people and change roles. Signed in to the organization,"
                    + " profile and teams are given too, and its administrators give them to people who are"
                    + " already members; POST .../permissions/preview shows what the person will hold (MK-056).")
    public MemberView put(
            @PathParam("slug") String slug,
            @PathParam("email") @Email @Size(max = 254) String email,
            @Valid MemberRequest request) {
        Organization organization = managed(slug);
        List<UUID> joined = request == null || request.teams() == null
                ? List.of()
                : List.copyOf(new LinkedHashSet<>(request.teams()));
        UUID profile = request == null ? null : request.profile();
        if ((profile != null || !joined.isEmpty()) && !actsIn(organization)) {
            throw new InvalidInputException(
                    List.of("profile and teams are given by the administrators of the organization, signed in to it"));
        }
        MemberView member = identity.hasRole(Roles.PLATFORM_ADMIN)
                ? service.putMember(slug, email, request)
                : existing(slug, email, request);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("roles", member.roles());
        if (profile != null) {
            permissions.assign(organization.getId(), email, profile);
            detail.put("profile", profile.toString());
        }
        for (UUID team : joined) {
            teams.putMember(team, email, TeamMember.MEMBER);
        }
        if (!joined.isEmpty()) {
            detail.put("teams", joined.stream().map(UUID::toString).toList());
        }
        audit("organization.member.updated", slug, email, detail);
        return member;
    }

    /**
     * A person who is already a member, for an administrator of the organization: they give profile
     * and teams, but adding people and changing roles stay with the platform administrators until
     * invitations that the person accepts (MK-068).
     */
    private MemberView existing(String slug, String email, MemberRequest request) {
        String username = email.trim().toLowerCase(Locale.ROOT);
        MemberView member = service.members(slug).stream()
                .filter(found -> found.username().equals(username))
                .findFirst()
                .orElseThrow(() -> new ForbiddenOperationException(
                        "Only the platform administrators add people to the organization."));
        if (request != null
                && request.roles() != null
                && !request.roles().isEmpty()
                && !Set.copyOf(request.roles()).equals(member.roles())) {
            throw new ForbiddenOperationException("Only the platform administrators change the roles of members.");
        }
        return member;
    }

    @DELETE
    @Path("/{email}")
    @Operation(summary = "Remove a person from an organization (platform administrators)")
    public void remove(@PathParam("slug") String slug, @PathParam("email") String email) {
        if (!identity.hasRole(Roles.PLATFORM_ADMIN)) {
            throw new ForbiddenOperationException("Only the platform administrators remove members.");
        }
        service.removeMember(slug, email, identity.getPrincipal().getName());
        audit("organization.member.removed", slug, email, Map.of());
    }

    /**
     * The organization, when the person manages its members: a platform administrator, or an
     * administrator of the organization signed in to it.
     */
    private Organization managed(String slug) {
        Organization organization = organizations.require(slug);
        boolean platform = identity.hasRole(Roles.PLATFORM_ADMIN);
        boolean administrator = identity.hasRole(Roles.ORGANIZATION_ADMIN) && actsIn(organization);
        if (!platform && !administrator) {
            throw new ForbiddenOperationException(
                    "Only the administrators of the organization and of the platform manage its members.");
        }
        return organization;
    }

    private boolean actsIn(Organization organization) {
        return RequestOrganization.of(identity)
                .filter(organization.getId()::equals)
                .isPresent();
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
