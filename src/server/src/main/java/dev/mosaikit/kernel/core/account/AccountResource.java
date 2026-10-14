// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.PermitAll;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.util.Map;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/** Self-registration, setting the password of a created account, and the signed-in account. */
@Path("/api/v1/accounts")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Tag(name = "Accounts")
public class AccountResource {

    private final AccountService service;
    private final SecurityIdentity identity;
    private final AuditLog audit;

    public AccountResource(AccountService service, SecurityIdentity identity, AuditLog audit) {
        this.service = service;
        this.identity = identity;
        this.audit = audit;
    }

    @GET
    @Path("/registration-options")
    @PermitAll
    @Operation(summary = "Whether people can create their own account, and in which organizations")
    public RegistrationOptions registrationOptions() {
        return service.registrationOptions();
    }

    @POST
    @Path("/registrations")
    @PermitAll
    @Operation(
            summary = "Register in an organization that allows self-registration",
            description = "201 with the account, or 202 when a link was sent to confirm the address first.")
    public Response register(
            @Valid @NotNull RegistrationRequest request, @Context UriInfo uri, @Context HttpHeaders headers) {
        AccountService.Registration registration =
                service.register(request, uri.getBaseUri(), headers.getAcceptableLanguages());
        if (registration.confirmationSent()) {
            return Response.accepted(Map.of("email", registration.account().username(), "confirmation", "sent"))
                    .build();
        }
        return Response.status(Response.Status.CREATED)
                .entity(registration.account())
                .build();
    }

    @POST
    @Path("/confirmations")
    @PermitAll
    @Operation(
            summary = "Confirm an email address with the token of the link sent to it",
            description = "204, or 404 when the link was used or expired.")
    public Response confirm(@Valid @NotNull ConfirmationRequest request) {
        if (!service.confirm(request.token())) {
            throw new ResourceNotFoundException(
                    "This link does not work any more: it was used or it expired. Ask for a new one.");
        }
        return Response.noContent().build();
    }

    @POST
    @Path("/confirmations/requests")
    @PermitAll
    @Operation(
            summary = "Send the link that confirms an email address again",
            description = "Always 202, so that nobody learns which addresses have an account.")
    public Response resend(@Valid @NotNull ResendRequest request, @Context UriInfo uri, @Context HttpHeaders headers) {
        service.resendConfirmation(request.email(), uri.getBaseUri(), headers.getAcceptableLanguages());
        return Response.accepted().build();
    }

    @POST
    @Path("/passwords")
    @PermitAll
    @Operation(
            summary = "Set the password of an account an administrator created, with the token of its link",
            description = "204, then the person signs in with the password; 404 when the link was used or expired.")
    public Response setPassword(@Valid @NotNull SetPasswordRequest request) {
        PasswordLinkService.Used used = service.setPassword(
                        request.token(), request.password().toCharArray())
                .orElseThrow(() -> new ResourceNotFoundException("This link does not work any more: it was used or"
                        + " it expired. Ask the administrator for a new one."));
        String username = used.account().getUsername();
        audit.append(
                username,
                used.organization(),
                "account.password-link.used",
                username,
                AuditEvent.Outcome.SUCCEEDED,
                Map.of());
        return Response.noContent().build();
    }

    /**
     * The token of a link that sets a password, and the password.
     *
     * @param password password of at least 12 characters, as for registration
     */
    public record SetPasswordRequest(
            @NotBlank @Size(max = 100) String token,

            @NotBlank @Size(min = 12, max = 128, message = "must be between 12 and 128 characters")
            String password) {

        /** Hides the token and the password from logs and error messages. */
        @Override
        public String toString() {
            return "SetPasswordRequest[]";
        }
    }

    /** The token of a confirmation link. */
    public record ConfirmationRequest(
            @NotBlank @Size(max = 100) String token) {}

    /** The address to send the confirmation link to again. */
    public record ResendRequest(
            @NotBlank @Email @Size(max = 254) String email) {}

    @GET
    @Path("/me/preferences")
    @Authenticated
    @Operation(summary = "Get the personal settings of the signed-in person")
    public Preferences preferences() {
        return service.preferences(identity.getPrincipal().getName());
    }

    @PUT
    @Path("/me/preferences")
    @Authenticated
    @Operation(
            summary = "Replace the personal settings of the signed-in person",
            description = "Theme, appearance, language and hidden apps, kept for the next sign-in (MK-027).")
    public Preferences changePreferences(@Valid @NotNull Preferences preferences) {
        return service.changePreferences(identity.getPrincipal().getName(), preferences);
    }

    @GET
    @Path("/me")
    @Authenticated
    @Operation(summary = "Get the signed-in account")
    public AccountView me() {
        return service.get(identity.getPrincipal().getName(), identity.getRoles(), RequestOrganization.of(identity));
    }
}
