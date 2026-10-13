// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/** The sessions of the signed-in person, which they see and end in their settings (MK-125). */
@Path("/api/v1/accounts/me/sessions")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Accounts")
public class MySessionsResource {

    private final SessionRegistry sessions;
    private final SecurityIdentity identity;
    private final AuditLog audit;

    public MySessionsResource(SessionRegistry sessions, SecurityIdentity identity, AuditLog audit) {
        this.sessions = sessions;
        this.identity = identity;
        this.audit = audit;
    }

    @GET
    @Operation(
            summary = "List the live sessions of the signed-in person",
            description = "The most recently seen first; the session of the request is marked current.")
    public List<SessionView> list() {
        UUID current = SessionRegistry.of(identity).orElse(null);
        return sessions.liveOf(account()).stream()
                .map(session -> SessionView.of(session, current))
                .toList();
    }

    @DELETE
    @Path("/{id}")
    @Operation(
            summary = "End a session of the signed-in person",
            description = "Its cookie, its \"remember me\" token and the tokens of its realm session open"
                    + " nothing any more. Ending the current session signs this browser out.")
    public Response end(@PathParam("id") UUID id) {
        if (!sessions.endOwn(account(), id)) {
            throw new ResourceNotFoundException("You have no live session with this identifier.");
        }
        boolean current = SessionRegistry.of(identity).filter(id::equals).isPresent();
        audit.append(
                identity.getPrincipal().getName(),
                RequestOrganization.of(identity),
                "account.session.ended",
                identity.getPrincipal().getName(),
                AuditEvent.Outcome.SUCCEEDED,
                Map.of("current", current));
        Response.ResponseBuilder ended = Response.noContent();
        if (current) {
            ended.cookie(SessionResource.expired(SessionResource.COOKIE), SessionResource.expired(RememberMe.COOKIE));
        }
        return ended.build();
    }

    private UUID account() {
        return RequestOrganization.account(identity)
                .orElseThrow(() -> new ResourceNotFoundException("No account for the current identity."));
    }
}
