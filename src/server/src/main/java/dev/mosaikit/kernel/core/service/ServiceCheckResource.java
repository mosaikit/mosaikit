// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.service;

import dev.mosaikit.kernel.core.account.AccessKey;
import dev.mosaikit.kernel.core.account.CredentialCheck;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ProblemDetail;
import dev.mosaikit.kernel.core.identity.OrganizationAccess;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * Lets a service identity (MK-124), such as a gateway in front of another server, check the
 * credentials a person sent it: the value of the session cookie of the shell (MK-125), with the
 * endpoint {@value ServiceRegistry#CHECK_SESSION}, or a personal access key (MK-060), with {@value
 * ServiceRegistry#CHECK_KEY}. It answers the person, the organization and the roles, or 401 when the
 * credentials open nothing. Only service identities given the endpoint reach it.
 */
@Path(ServiceCheckResource.PATH)
@Produces(MediaType.APPLICATION_JSON)
@RolesAllowed(Roles.SERVICE)
@Tag(name = "Services")
public class ServiceCheckResource {

    static final String PATH = "/api/v1/services/check";

    private static final ProblemDetail INVALID = new ProblemDetail(
            "about:blank", "Unauthorized", 401, "These credentials do not sign anybody in.", List.of());

    private final CredentialCheck check;
    private final SecurityIdentity identity;
    private final ServiceAudit audit;

    public ServiceCheckResource(CredentialCheck check, SecurityIdentity identity, ServiceAudit audit) {
        this.check = check;
        this.identity = identity;
        this.audit = audit;
    }

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Operation(
            summary = "Check the session or the access key of a person",
            description = "For service identities given check-session or check-key: called with the value of the"
                    + " session cookie of a person, and the organization the shell names, or with a personal"
                    + " access key, it answers the person, the organization and the roles, or 401.")
    public Response check(ServiceIdentityView.Check request) {
        boolean session = request != null
                && request.session() != null
                && !request.session().isBlank();
        boolean key = request != null && request.key() != null && !request.key().isBlank();
        if (session == key) {
            throw new InvalidInputException(List.of("give one of session and key"));
        }
        String endpoint = session ? ServiceRegistry.CHECK_SESSION : ServiceRegistry.CHECK_KEY;
        ServiceIdentity.Grants grants = identity.getAttribute(ServiceGuard.GRANTS_ATTRIBUTE);
        if (grants == null || !grants.endpoints().contains(endpoint)) {
            audit.refused(caller(), endpoint, "POST", PATH, "not-granted");
            throw new ForbiddenOperationException("This service identity was not given " + endpoint + ".");
        }
        Optional<CredentialCheck.Person> person = session
                ? check.session(request.session().strip(), request.organization())
                : check.key(request.key().strip());
        if (person.isEmpty()) {
            return Response.status(Response.Status.UNAUTHORIZED)
                    .type(ProblemDetail.MEDIA_TYPE)
                    .entity(INVALID)
                    .build();
        }
        return Response.ok(view(session ? "session" : "key", person.get())).build();
    }

    private static ServiceIdentityView.Checked view(String kind, CredentialCheck.Person person) {
        SecurityIdentity checked = Objects.requireNonNull(person.identity(), "a checked credential has an identity");
        ServiceIdentityView.Place organization = RequestOrganization.of(checked)
                .map(id -> new ServiceIdentityView.Place(id, checked.getAttribute(OrganizationAccess.SLUG_ATTRIBUTE)))
                .orElse(null);
        return new ServiceIdentityView.Checked(
                kind,
                new ServiceIdentityView.Person(
                        person.account().getId(),
                        person.account().getUsername(),
                        person.account().getDisplayName()),
                organization,
                checked.getRoles().stream().sorted().toList(),
                person.key().map(ServiceCheckResource::key).orElse(null));
    }

    private static ServiceIdentityView.CheckedKey key(AccessKey key) {
        return new ServiceIdentityView.CheckedKey(
                key.getId(), key.getName(), key.getPrefix(), key.canWrite(), key.getExpiresAt());
    }

    private ServiceAudit.Caller caller() {
        return new ServiceAudit.Caller(
                UUID.fromString(identity.getAttribute(ServiceRegistry.ATTRIBUTE)),
                identity.getAttribute(ServiceRegistry.NAME_ATTRIBUTE),
                UUID.fromString(identity.getAttribute(ServiceRegistry.KEY_ATTRIBUTE)),
                identity.getAttribute(ServiceRegistry.PREFIX_ATTRIBUTE),
                RequestOrganization.of(identity).orElse(null));
    }
}
