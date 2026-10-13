// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.HashMap;
import java.util.Map;

/**
 * Stands for the Java code of an extension whose API ({@value ServiceIdentityTest#API}) a service
 * identity calls (MK-124): it answers who the caller is, as an extension sees it.
 */
@Path("/api/v1/ext/" + ServiceIdentityTest.API + "/caller")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class ServiceProbe {

    private final SecurityIdentity identity;
    private final CurrentOrganization organization;

    public ServiceProbe(SecurityIdentity identity, CurrentOrganization organization) {
        this.identity = identity;
        this.organization = organization;
    }

    @GET
    public Map<String, Object> caller() {
        Map<String, Object> caller = new HashMap<>();
        caller.put("name", identity.getPrincipal().getName());
        caller.put("service", identity.hasRole("service"));
        caller.put("roles", identity.getRoles());
        caller.put("organization", organization.slug().orElse(null));
        return caller;
    }

    @POST
    public Map<String, Object> write() {
        return caller();
    }
}
