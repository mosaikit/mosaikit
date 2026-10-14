// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.ServiceUnavailableException;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.OrganizationService;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.UriInfo;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.TreeSet;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/**
 * Local accounts that administrators create for people (MK-048): the administrators of an
 * organization, signed in to it, for their organization, and the platform administrators for any. The
 * person sets the password with a link that works once: mailed to them when the installation sends
 * mail, otherwise returned this once for the administrator to pass on.
 */
@Path("/api/v1/organizations/{slug}/accounts")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Organizations")
public class OrganizationAccountResource {

    private final AccountService service;
    private final OrganizationService organizations;
    private final ConfirmationMail mailer;
    private final MailDelivery delivery;
    private final AuditLog audit;
    private final SecurityIdentity identity;

    public OrganizationAccountResource(
            AccountService service,
            OrganizationService organizations,
            ConfirmationMail mailer,
            MailDelivery delivery,
            AuditLog audit,
            SecurityIdentity identity) {
        this.service = service;
        this.organizations = organizations;
        this.mailer = mailer;
        this.delivery = delivery;
        this.audit = audit;
        this.identity = identity;
    }

    @POST
    @Operation(
            summary = "Create a local account for a person, with a link to set the password",
            description = "Administrators of the organization and of the platform. 201 with the member and the link,"
                    + " which works once: mailed to the person when the installation sends mail (link empty),"
                    + " otherwise returned this once; 409 when the address has an account already.")
    public Response create(
            @PathParam("slug") String slug, @Valid @NotNull NewAccountRequest request, @Context UriInfo uri) {
        Organization organization = managed(slug);
        AccountService.PasswordLinkIssue issue =
                service.createLocalAccount(slug, request, delivery.configured(), uri.getBaseUri());
        String email = issue.member().username();
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("roles", new TreeSet<>(issue.member().roles()));
        detail.put("delivery", deliveryOf(issue));
        record(organization, "organization.account.created", slug + "/" + email, detail);
        PasswordLinkView view = deliver(organization, slug, issue, true);
        return Response.status(Response.Status.CREATED).entity(view).build();
    }

    @POST
    @Path("/{email}/password-link")
    @Operation(
            summary = "Issue a new link to set the password of an account an administrator created",
            description = "For a member who has not set a password yet; the previous link stops working. The link"
                    + " is mailed, or returned this once when the installation sends no mail. An administrator of"
                    + " the organization issues it only for people who belong to no other organization.")
    public PasswordLinkView reissue(
            @PathParam("slug") String slug, @PathParam("email") String email, @Context UriInfo uri) {
        Organization organization = managed(slug);
        AccountService.PasswordLinkIssue issue = service.reissuePasswordLink(
                slug, email, identity.hasRole(Roles.PLATFORM_ADMIN), delivery.configured(), uri.getBaseUri());
        return deliver(organization, slug, issue, false);
    }

    /** Audits the link and mails it, after the transaction that wrote it has committed. */
    private PasswordLinkView deliver(
            Organization organization, String slug, AccountService.PasswordLinkIssue issue, boolean created) {
        MemberView member = issue.member();
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("delivery", deliveryOf(issue));
        detail.put("expiresAt", issue.issued().expiresAt().toString());
        record(organization, "account.password-link.issued", slug + "/" + member.username(), detail);
        if (issue.mail().isEmpty()) {
            return new PasswordLinkView(
                    member, false, issue.issued().link(), issue.issued().expiresAt());
        }
        try {
            mailer.deliver(issue.mail().get());
        } catch (ServiceUnavailableException e) {
            throw new ServiceUnavailableException((created ? "The account was created, but the" : "The")
                    + " mail with the link to set the password could not be sent. Issue a new link in a few"
                    + " minutes, or check the mail server of the installation.");
        }
        return new PasswordLinkView(member, true, null, issue.issued().expiresAt());
    }

    private static String deliveryOf(AccountService.PasswordLinkIssue issue) {
        return issue.mail().isPresent() ? "mail" : "link";
    }

    /**
     * The organization, when the person manages its accounts: a platform administrator, or an
     * administrator of the organization signed in to it.
     */
    private Organization managed(String slug) {
        Organization organization = organizations.require(slug);
        boolean platform = identity.hasRole(Roles.PLATFORM_ADMIN);
        boolean administrator = identity.hasRole(Roles.ORGANIZATION_ADMIN)
                && RequestOrganization.of(identity)
                        .filter(organization.getId()::equals)
                        .isPresent();
        if (!platform && !administrator) {
            throw new ForbiddenOperationException(
                    "Only the administrators of the organization and of the platform create its accounts.");
        }
        return organization;
    }

    private void record(Organization organization, String action, String subject, Map<String, ?> detail) {
        audit.append(
                identity.getPrincipal().getName(),
                Optional.of(organization.getId()),
                action,
                subject,
                AuditEvent.Outcome.SUCCEEDED,
                detail);
    }
}
