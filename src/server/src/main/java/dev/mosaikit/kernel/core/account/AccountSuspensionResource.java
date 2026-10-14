// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
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

/**
 * The suspension of an account by a platform administrator (MK-125): a suspended person signs in by
 * no means, with a password, "remember me" or the realm of an organization, and their sessions end
 * at once. The reason the administrator gives is shown with the status and kept in the audit log.
 */
@Path("/api/v1/platform/accounts")
@Produces(MediaType.APPLICATION_JSON)
@RolesAllowed(Roles.PLATFORM_ADMIN)
@Tag(name = "Platform")
public class AccountSuspensionResource {

    private final AccountService service;
    private final SecurityIdentity identity;
    private final AuditLog audit;

    public AccountSuspensionResource(AccountService service, SecurityIdentity identity, AuditLog audit) {
        this.service = service;
        this.identity = identity;
        this.audit = audit;
    }

    @GET
    @Path("/suspended")
    @Operation(
            summary = "List the suspended accounts",
            description = "The most recently suspended first, with when, by whom and why.")
    public List<AccountStatus> suspended() {
        return service.suspended();
    }

    @GET
    @Path("/{email}/suspension")
    @Operation(
            summary = "Read whether an account is suspended",
            description = "With when, by whom and why, while it is.")
    public AccountStatus status(@PathParam("email") String email) {
        return service.status(email);
    }

    @PUT
    @Path("/{email}/suspension")
    @Consumes(MediaType.APPLICATION_JSON)
    @Operation(
            summary = "Suspend an account and end its sessions",
            description = "Its sessions, \"remember me\" tokens and realm sessions open nothing any more."
                    + " The body may give the reason, {\"reason\": \"…\"}, at most 500 characters."
                    + " Administrators cannot suspend their own account.")
    public AccountStatus suspend(@PathParam("email") String email, SuspensionRequest request) {
        String administrator = identity.getPrincipal().getName();
        AccountStatus status = service.suspend(email, administrator, request == null ? null : request.reason());
        audit(
                "account.suspended",
                administrator,
                status,
                status.reason() == null ? Map.of() : Map.of("reason", status.reason()));
        return status;
    }

    @DELETE
    @Path("/{email}/suspension")
    @Operation(summary = "Reactivate a suspended account", description = "The person signs in again.")
    public AccountStatus reactivate(@PathParam("email") String email) {
        String administrator = identity.getPrincipal().getName();
        AccountStatus status = service.reactivate(email);
        audit("account.reactivated", administrator, status, Map.of());
        return status;
    }

    private void audit(String action, String administrator, AccountStatus status, Map<String, ?> detail) {
        audit.append(administrator, Optional.empty(), action, status.username(), AuditEvent.Outcome.SUCCEEDED, detail);
    }
}
