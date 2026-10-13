// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.apps;

import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.permissions.KernelPermissions;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/** The apps of the app bar of the signed-in person, as the organization shows them (MK-030). */
@Path("/api/v1/shell/apps")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Apps")
public class ShellAppsResource {

    private final AppSettings settings;
    private final SecurityIdentity identity;
    private final KernelPermissions permissions;

    public ShellAppsResource(AppSettings settings, SecurityIdentity identity, KernelPermissions permissions) {
        this.settings = settings;
        this.identity = identity;
        this.permissions = permissions;
    }

    @GET
    @Operation(
            summary = "Get the apps the signed-in person sees in the app bar, in order",
            description = "An app restricted to the people who hold its permission shows only to them; a guest"
                    + " sees only the apps whose permission a team or a personal exception grants (MK-056).")
    public List<ShellApp> forShell() {
        Optional<UUID> organization = RequestOrganization.of(identity);
        if (organization.isEmpty()) {
            return settings.forPerson(organization, false, _ -> false);
        }
        Set<String> held = permissions.heldIds();
        return settings.forPerson(organization, RequestOrganization.guest(identity), held::contains);
    }
}
