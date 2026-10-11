// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.ai;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.context.NoOrganizationException;
import io.quarkus.security.identity.SecurityIdentity;
import java.util.Objects;
import java.util.UUID;

/**
 * The person on whose behalf a tool runs, in one organization. The call to the plugin carries the
 * credentials of the person, so that the plugin checks the permissions of the person itself.
 *
 * @param username username of the person
 * @param organizationId the organization the tool acts on
 * @param organizationSlug slug of that organization, sent to the plugin
 * @param authorization the {@code Authorization} header of the request, if it had one
 * @param session the session cookie of the shell ({@code mosaikit-session}), when the request
 *     came from the shell without an {@code Authorization} header
 */
public record Caller(
        String username, UUID organizationId, String organizationSlug, String authorization, String session) {

    public Caller {
        Objects.requireNonNull(username, "username");
        Objects.requireNonNull(organizationId, "organizationId");
        Objects.requireNonNull(organizationSlug, "organizationSlug");
    }

    public Caller(String username, UUID organizationId, String organizationSlug, String authorization) {
        this(username, organizationId, organizationSlug, authorization, null);
    }

    /**
     * The person of a request.
     *
     * @throws NoOrganizationException when the request has no organization
     */
    public static Caller of(SecurityIdentity identity, CurrentOrganization organization, String authorization) {
        return of(identity, organization, authorization, null);
    }

    /** The person of a request of the shell, which may carry its session cookie instead. */
    public static Caller of(
            SecurityIdentity identity, CurrentOrganization organization, String authorization, String session) {
        return new Caller(
                identity.getPrincipal().getName(),
                organization.require(),
                organization.slug().orElseThrow(NoOrganizationException::new),
                authorization,
                session);
    }
}
