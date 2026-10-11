// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.teams;

import dev.mosaikit.kernel.core.identity.RequestOrganization;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.Priority;
import jakarta.inject.Inject;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;
import java.util.List;
import java.util.Map;

/**
 * Keeps the guests of an organization (MK-032) to what concerns them: their account, their teams,
 * the documents shared with their teams, their activity and what the shell needs. The APIs of the
 * plugin backends, the assistant and the administration are refused, since they would show the
 * data of the organization.
 */
@Provider
@Priority(Priorities.AUTHORIZATION + 5)
public class GuestAccessFilter implements ContainerRequestFilter {

    /** The paths open to guests; the row-level security limits the documents to their teams. */
    static final List<String> OPEN = List.of(
            "/api/v1/accounts/",
            "/api/v1/data/",
            "/api/v1/identity",
            "/api/v1/notifications",
            "/api/v1/plugin-assets/",
            "/api/v1/shell/",
            "/api/v1/system/",
            "/api/v1/teams");

    @Inject
    SecurityIdentity identity;

    @Override
    public void filter(ContainerRequestContext request) {
        if (!RequestOrganization.guest(identity)) {
            return;
        }
        String path = request.getUriInfo().getPath();
        String absolute = path.startsWith("/") ? path : "/" + path;
        if (OPEN.stream().noneMatch(absolute::startsWith)) {
            request.abortWith(Response.status(Response.Status.FORBIDDEN)
                    .type("application/problem+json")
                    .entity(Map.of(
                            "type", "about:blank",
                            "title", "Forbidden",
                            "status", 403,
                            "detail", "A guest of the organization sees only the teams where they were added."))
                    .build());
        }
    }
}
