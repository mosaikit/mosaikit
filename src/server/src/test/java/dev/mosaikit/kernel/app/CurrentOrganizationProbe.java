// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.Map;

/** Stands for the Java code of a plugin that reads the organization of the request (MK-017). */
@Path("/api/v1/test/current-organization")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class CurrentOrganizationProbe {

    private final CurrentOrganization organization;

    public CurrentOrganizationProbe(CurrentOrganization organization) {
        this.organization = organization;
    }

    @GET
    public Map<String, String> get() {
        return Map.of(
                "id",
                organization.require().toString(),
                "slug",
                organization.slug().orElseThrow());
    }
}
