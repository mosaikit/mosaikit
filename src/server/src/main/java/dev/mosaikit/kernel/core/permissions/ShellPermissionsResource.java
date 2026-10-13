// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.permissions;

import io.quarkus.security.Authenticated;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The permissions of the signed-in person in the organization of the request (MK-056), for the shell
 * and the frontends of extensions, which hide what is not available. The backends enforce them.
 */
@Path("/api/v1/shell/permissions")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Permissions")
public class ShellPermissionsResource {

    private final KernelPermissions permissions;

    public ShellPermissionsResource(KernelPermissions permissions) {
        this.permissions = permissions;
    }

    @GET
    @Operation(
            summary = "List the permissions of the signed-in person, as <extension>:<permission>",
            description = "Empty without an organization. Only a hint for the interface: the backends check.")
    public List<String> held() {
        return List.copyOf(permissions.heldIds());
    }
}
