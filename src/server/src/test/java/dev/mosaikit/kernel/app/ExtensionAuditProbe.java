// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.audit.AuditLog;
import io.quarkus.security.Authenticated;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;

/**
 * Stands for the Java code of an extension that records its sensitive actions in the audit log of the
 * organization (MK-059): it calls the {@link AuditLog} bean of kernel-api as an extension does, naming
 * the extension in every call.
 */
@Path("/api/v1/test/extension-audit")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
public class ExtensionAuditProbe {

    /** What the extension records. */
    public record Body(String action, String object, AuditLog.Outcome outcome, Map<String, Object> details) {}

    private final AuditLog audit;

    public ExtensionAuditProbe(AuditLog audit) {
        this.audit = audit;
    }

    /** Records an entry; with {@code rollback}, the work of the caller then fails and rolls back. */
    @POST
    @Path("/{extension}")
    @Transactional
    public Response record(
            @PathParam("extension") String extension, @QueryParam("rollback") boolean rollback, Body body) {
        try {
            audit.record(
                    extension,
                    new AuditLog.Entry(
                            body.action(),
                            body.object(),
                            body.outcome() == null ? AuditLog.Outcome.SUCCEEDED : body.outcome(),
                            body.details()));
        } catch (IllegalArgumentException e) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(Map.of("message", e.getMessage()))
                    .build();
        }
        if (rollback) {
            throw new IllegalStateException("The work of the extension failed after it recorded the attempt");
        }
        return Response.noContent().build();
    }
}
