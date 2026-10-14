// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.teams;

import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.web.ExtensionApiGuard;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.Provider;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Keeps the guests of an organization (MK-032) to what concerns them: their account, their teams,
 * the documents and files shared with their teams (MK-041), the resources shared with them (MK-055), their activity
 * and what the shell needs. The API of an extension backend is open to a guest only when the
 * organization gave them something of that extension, a permission or a shared resource
 * ({@link GuestExtensionAccess}); the extension then checks what they reach, with the same rules as
 * for members. The assistant and the administration are refused, since they would show the data of
 * the organization.
 */
@Provider
@Priority(Priorities.AUTHORIZATION + 5)
public class GuestAccessFilter implements ContainerRequestFilter {

    /** The paths open to guests; the row-level security limits the documents and files to their teams. */
    static final List<String> OPEN = List.of(
            "/api/v1/accounts/",
            "/api/v1/data/",
            "/api/v1/identity",
            "/api/v1/notifications",
            "/api/v1/extension-assets/",
            "/api/v1/files/",
            "/api/v1/sharing/",
            "/api/v1/shell/",
            "/api/v1/system/",
            "/api/v1/teams");

    private static final String NOTHING_SHARED =
            "A guest of the organization reaches the API of an extension only when a team of theirs or an"
                    + " exception grants them one of its permissions, or one of its resources is theirs or shared"
                    + " with them.";

    private final SecurityIdentity identity;
    private final GuestExtensionAccess extensions;

    public GuestAccessFilter(SecurityIdentity identity, GuestExtensionAccess extensions) {
        this.identity = identity;
        this.extensions = extensions;
    }

    @Override
    public void filter(ContainerRequestContext request) {
        if (!RequestOrganization.guest(identity)) {
            return;
        }
        String path = request.getUriInfo().getPath();
        String absolute = path.startsWith("/") ? path : "/" + path;
        if (OPEN.stream().anyMatch(absolute::startsWith)) {
            return;
        }
        Optional<String> api = ExtensionApiGuard.apiName(absolute);
        if (api.isPresent()) {
            Optional<UUID> organization = RequestOrganization.of(identity);
            Optional<UUID> account = RequestOrganization.account(identity);
            if (organization.isPresent()
                    && account.isPresent()
                    && extensions.allows(organization.get(), account.get(), api.get())) {
                return;
            }
            refuse(request, NOTHING_SHARED);
            return;
        }
        refuse(request, "A guest of the organization sees only the teams where they were added.");
    }

    private static void refuse(ContainerRequestContext request, String detail) {
        request.abortWith(Response.status(Response.Status.FORBIDDEN)
                .type("application/problem+json")
                .entity(Map.of("type", "about:blank", "title", "Forbidden", "status", 403, "detail", detail))
                .build());
    }
}
