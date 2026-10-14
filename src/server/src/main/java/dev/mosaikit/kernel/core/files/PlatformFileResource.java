// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The contents of files whose record is gone (#102), for platform administrators: what waits for the
 * clean-up, the files of extensions no longer installed, and the clean-up itself, which runs only
 * when asked.
 */
@Path("/api/v1/platform/files")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@RolesAllowed(Roles.PLATFORM_ADMIN)
@Tag(name = "Platform")
public class PlatformFileResource {

    private final FileRemovals removals;
    private final SecurityIdentity identity;

    public PlatformFileResource(FileRemovals removals, SecurityIdentity identity) {
        this.removals = removals;
        this.identity = identity;
    }

    @GET
    @Path("/removals")
    @Operation(
            summary = "The contents of files waiting to leave the store, and the files of extensions no longer"
                    + " installed")
    public FileRemovals.Pending pending() {
        return removals.pending();
    }

    @POST
    @Path("/removals/extensions/{extension}")
    @Operation(
            summary = "Queue the files of an uninstalled extension for removal",
            description = "In every organization. Their records stay until a clean-up after the retention, which"
                    + " removes them only if the extension is still not installed. 409 when the extension is"
                    + " installed, or when no extension is; 404 when it has no files.")
    public FileRemovals.Queued queueExtension(@PathParam("extension") String extension) {
        return removals.queueExtension(extension, identity.getPrincipal().getName());
    }

    @POST
    @Path("/clean-up")
    @Operation(
            summary = "Remove from the store the contents queued before mosaikit.files.removal-retention",
            description = "Contents of deleted files, teams and organizations, and of uninstalled extensions that"
                    + " were queued. 503, with nothing removed, when the store does not hold the files the"
                    + " database records.")
    public FileRemovals.CleanUp cleanUp() {
        return removals.run(identity.getPrincipal().getName());
    }
}
