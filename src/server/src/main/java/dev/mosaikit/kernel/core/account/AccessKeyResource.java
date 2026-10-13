// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.identity.OrganizationAccess;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * Lets a service check a personal access key it received (MK-060): it calls this endpoint with the
 * same key, as {@code Authorization: Bearer}, and learns whom the key acts for. The key is its own
 * credential, so the service needs no secret of its own and learns nothing about other keys; a
 * revoked or expired key, or one of a suspended person, is refused with 401 like on every other API.
 * Service identities (MK-124) check keys and sessions with credentials of their own, with {@code POST
 * /api/v1/services/check}.
 */
@Path("/api/v1/access-keys/current")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Accounts")
public class AccessKeyResource {

    private final AccessKeyRegistry keys;
    private final AccountService accounts;
    private final SecurityIdentity identity;

    public AccessKeyResource(AccessKeyRegistry keys, AccountService accounts, SecurityIdentity identity) {
        this.keys = keys;
        this.accounts = accounts;
        this.identity = identity;
    }

    @GET
    @Operation(
            summary = "Validate the access key of the request",
            description = "For services that receive a personal access key: called with that key, it answers"
                    + " the person and the organization the key acts for, the roles of the person there now,"
                    + " whether the key may write and when it expires.")
    public AccessKeyView.Validation current() {
        String id = identity.getAttribute(AccessKeyRegistry.ATTRIBUTE);
        if (id == null) {
            throw new ResourceNotFoundException("This request carries no access key.");
        }
        UUID account = RequestOrganization.account(identity).orElseThrow();
        UUID organization = RequestOrganization.of(identity).orElseThrow();
        AccessKey key = keys.byId(UUID.fromString(id))
                .orElseThrow(() -> new ResourceNotFoundException("This request carries no access key."));
        UserAccount person = accounts.findForAuthentication(account)
                .orElseThrow(() -> new ResourceNotFoundException("No account for the current identity."));
        return new AccessKeyView.Validation(
                key.getId(),
                key.getName(),
                key.getPrefix(),
                key.canWrite(),
                key.getExpiresAt(),
                new AccessKeyView.Person(person.getId(), person.getUsername(), person.getDisplayName()),
                new AccessKeyView.Place(organization, identity.getAttribute(OrganizationAccess.SLUG_ATTRIBUTE)),
                AccessKeyView.sorted(identity.getRoles()));
    }
}
