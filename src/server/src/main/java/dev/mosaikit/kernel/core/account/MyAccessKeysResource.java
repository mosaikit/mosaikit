// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.identity.IdentityDirectory;
import dev.mosaikit.kernel.core.identity.OrganizationAccess;
import dev.mosaikit.kernel.core.identity.OrganizationIdentity;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The personal access keys of the signed-in person (MK-060), which they create, see and revoke in
 * their settings. A request made with a key never reaches these endpoints ({@link AccessKeyGuard}).
 */
@Path(MyAccessKeysResource.PATH)
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Accounts")
public class MyAccessKeysResource {

    static final String PATH = "/api/v1/accounts/me/access-keys";

    private final AccessKeyRegistry keys;
    private final IdentityDirectory directory;
    private final OrganizationAccess access;
    private final SecurityIdentity identity;
    private final AuditLog audit;
    private final AccessKeyAudit keyAudit;
    private final Clock clock;

    public MyAccessKeysResource(
            AccessKeyRegistry keys,
            IdentityDirectory directory,
            OrganizationAccess access,
            SecurityIdentity identity,
            AuditLog audit,
            AccessKeyAudit keyAudit,
            Clock clock) {
        this.keys = keys;
        this.directory = directory;
        this.access = access;
        this.identity = identity;
        this.audit = audit;
        this.keyAudit = keyAudit;
        this.clock = clock;
    }

    @GET
    @Operation(
            summary = "List the access keys of the signed-in person",
            description = "The keys not revoked, expired ones included, the newest first; never their secret.")
    public AccessKeyView.Keys list() {
        Instant now = Instant.now(clock);
        List<AccessKeyView> found = keys.of(account()).stream()
                .map(key -> AccessKeyView.of(key, slug(key.getOrganizationId()), now, null))
                .toList();
        return new AccessKeyView.Keys(Math.max(1, keys.maxValidity().toDays()), found);
    }

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Operation(
            summary = "Create an access key",
            description = "For scripts and clients that cannot use the session of the browser. The answer holds"
                    + " the secret, shown this once: the kernel keeps only its digest.")
    public Response create(AccessKeyView.Request request) {
        if (request == null) {
            throw new InvalidInputException(List.of("name is required"));
        }
        UUID account = account();
        OrganizationAccess.Access organization = organization(account, request.organization());
        AccessKeyRegistry.Created created = keys.create(
                account,
                organization.organizationId(),
                request.name(),
                request.expiresAt(),
                Boolean.TRUE.equals(request.write()));
        AccessKey key = created.key();
        audit.append(
                identity.getPrincipal().getName(),
                Optional.of(organization.organizationId()),
                "account.access-key.created",
                key.getPrefix(),
                AuditEvent.Outcome.SUCCEEDED,
                Map.of(
                        "key", key.getId().toString(),
                        "name", key.getName(),
                        "write", key.canWrite(),
                        "expiresAt", key.getExpiresAt().toString()));
        return Response.status(Response.Status.CREATED)
                .entity(AccessKeyView.of(key, organization.slug(), Instant.now(clock), created.secret()))
                .build();
    }

    @DELETE
    @Path("/{id}")
    @Operation(
            summary = "Revoke an access key of the signed-in person",
            description = "The next request with the key is refused; the sessions of the person go on.")
    public Response revoke(@PathParam("id") UUID id) {
        AccessKey key = keys.revokeOwn(account(), id)
                .orElseThrow(() -> new ResourceNotFoundException("You have no access key with this identifier."));
        keyAudit.revoked(identity.getPrincipal().getName(), key, "person");
        return Response.noContent().build();
    }

    /** The organization a new key acts on: one the person is a member of. */
    private OrganizationAccess.Access organization(UUID account, String slug) {
        UUID id;
        if (slug == null || slug.isBlank()) {
            id = RequestOrganization.of(identity)
                    .orElseThrow(() -> new InvalidInputException(
                            List.of("organization is required: choose the organization the key acts on")));
        } else {
            id = directory
                    .routing()
                    .bySlug(slug.strip().toLowerCase(Locale.ROOT))
                    .map(OrganizationIdentity::id)
                    .orElse(null);
        }
        return (id == null ? Optional.<OrganizationAccess.Access>empty() : access.forKey(account, id))
                .orElseThrow(
                        () -> new InvalidInputException(List.of("organization must be one of your organizations")));
    }

    private String slug(UUID organizationId) {
        return directory
                .routing()
                .byId(organizationId)
                .map(OrganizationIdentity::slug)
                .orElse(null);
    }

    private UUID account() {
        return RequestOrganization.account(identity)
                .orElseThrow(() -> new ResourceNotFoundException("No account for the current identity."));
    }
}
