// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import dev.mosaikit.kernel.core.config.KernelConfig;
import io.vertx.core.http.HttpServerRequest;
import jakarta.annotation.security.PermitAll;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import java.util.Optional;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/** Tells the UI how a person signs in: through the realm of an organization or with a password. */
@Path("/api/v1/identity")
@Produces(MediaType.APPLICATION_JSON)
@Tag(name = "Identity")
public class SignInResource {

    private final IdentityDirectory directory;
    private final KernelConfig.Identity config;

    public SignInResource(IdentityDirectory directory, KernelConfig config) {
        this.directory = directory;
        this.config = config.identity();
    }

    @GET
    @Path("/sign-in-options")
    @PermitAll
    @Operation(summary = "Get the sign-in options for the sub-domain of the request or an email address")
    public SignInOptions options(@QueryParam("email") String email, @Context HttpServerRequest request) {
        IdentityRouting routing = directory.routing();
        String host = request.authority() == null ? null : request.authority().host();
        Optional<OrganizationIdentity> organization = routing.byHost(host).or(() -> routing.byEmail(email));
        if (organization.isEmpty()) {
            return new SignInOptions(null, null);
        }
        var federation = routing.issuer(organization.get())
                .map(issuer -> new SignInOptions.Federation(issuer, config.clientId()))
                .orElse(null);
        return new SignInOptions(organization.get().slug(), federation);
    }
}
