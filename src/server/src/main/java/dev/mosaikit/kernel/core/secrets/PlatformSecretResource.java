// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import dev.mosaikit.kernel.core.secrets.SecretAdministration.KeysView;
import dev.mosaikit.kernel.core.secrets.SecretAdministration.ReEncryption;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * The master keys of the store of credentials (MK-062), for platform administrators: which keys
 * are configured and how many credentials each holds, and the re-encryption that ends a rotation.
 */
@Path("/api/v1/platform/secrets")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@RolesAllowed(Roles.PLATFORM_ADMIN)
@Tag(name = "Platform")
public class PlatformSecretResource {

    private final SecretAdministration administration;
    private final SecurityIdentity identity;

    public PlatformSecretResource(SecretAdministration administration, SecurityIdentity identity) {
        this.administration = administration;
        this.identity = identity;
    }

    @GET
    @Path("/keys")
    @Operation(summary = "The master keys of the store of credentials, and how many credentials each one holds")
    public KeysView keys() {
        return administration.keys();
    }

    @POST
    @Path("/re-encryption")
    @Operation(
            summary = "Encrypt the data keys of every credential again with the current master key",
            description = "After a rotation, with the former key in mosaikit.secrets.previous-keys. Values are"
                    + " not decrypted. Answers how many credentials moved and how many could not be read.")
    public ReEncryption reEncrypt() {
        return administration.reEncrypt(identity.getPrincipal().getName());
    }
}
