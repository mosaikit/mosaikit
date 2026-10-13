// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.Map;
import java.util.Optional;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The suspension of an account by a platform administrator (MK-125): a suspended person signs in by
 * no means, with a password, "remember me" or the realm of an organization, and their sessions end
 * at once.
 */
@Path("/api/v1/platform/accounts/{email}/suspension")
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

    @PUT
    @Operation(
            summary = "Suspend an account and end its sessions",
            description = "Its sessions, \"remember me\" tokens and realm sessions open nothing any more."
                    + " Administrators cannot suspend their own account.")
    public AccountStatus suspend(@PathParam("email") String email) {
        String administrator = identity.getPrincipal().getName();
        AccountStatus status = service.suspend(email, administrator);
        audit("account.suspended", administrator, status);
        return status;
    }

    @DELETE
    @Operation(summary = "Reactivate a suspended account", description = "The person signs in again.")
    public AccountStatus reactivate(@PathParam("email") String email) {
        String administrator = identity.getPrincipal().getName();
        AccountStatus status = service.reactivate(email);
        audit("account.reactivated", administrator, status);
        return status;
    }

    private void audit(String action, String administrator, AccountStatus status) {
        audit.append(
                administrator, Optional.empty(), action, status.username(), AuditEvent.Outcome.SUCCEEDED, Map.of());
    }
}
