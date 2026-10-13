// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import com.fasterxml.jackson.annotation.JsonInclude;
import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.extension.SubjectKind;
import dev.mosaikit.kernel.api.permission.AccessDeniedException;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.sharing.Grant;
import dev.mosaikit.kernel.api.sharing.Subject;
import dev.mosaikit.kernel.core.account.UserAccount;
import dev.mosaikit.kernel.core.account.UserAccounts;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.Organizations;
import dev.mosaikit.kernel.core.resources.RegisteredResource;
import dev.mosaikit.kernel.core.teams.Team;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Supplier;

/**
 * What the sharing dialog of the kernel shows and does (MK-055), for the REST API: the same dialog
 * for every resource type, on the {@link KernelSharing} bean that extensions call.
 */
@ApplicationScoped
@Transactional
public class SharingDialog {

    /**
     * A level of a type.
     *
     * @param edits whether it lets people change the resource
     */
    public record LevelView(String name, String title, boolean edits, Map<String, Map<String, String>> i18n) {}

    /**
     * A resource as the dialog opens it.
     *
     * @param level the highest level of the person of the request
     * @param canShare whether they may grant and revoke
     * @param levels the levels of the type, from the lowest to the highest
     * @param subjects the kinds of subjects the type accepts
     * @param linkLevel the most a link gives
     * @param linkMaxExpiry the latest expiry a link made now may have
     */
    public record ResourceView(
            ResourceRef resource,
            String title,
            String link,
            UUID owner,
            String level,
            boolean canShare,
            List<LevelView> levels,
            List<String> subjects,
            String linkLevel,
            Instant linkMaxExpiry) {}

    /**
     * Who a grant is for.
     *
     * @param kind {@code person}, {@code group}, {@code organization}, {@code link} or {@code public}
     * @param id the account of a person, the team of a group, the link; none for the others
     * @param name the display name of the person, the name of the team or of the organization
     * @param email the username of a person
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record SubjectView(String kind, UUID id, String name, String email) {}

    /**
     * A grant as the dialog lists it.
     *
     * @param expires the expiry of a link
     * @param password whether a link asks for a password
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record GrantView(
            UUID id,
            SubjectView subject,
            String level,
            UUID grantedBy,
            String grantedByName,
            Instant granted,
            Instant expires,
            Boolean password) {}

    /**
     * A link just made.
     *
     * @param address the address to give to people, with the secret
     * @param token the secret alone: the kernel keeps only its hash, so it is shown this once
     */
    public record LinkView(GrantView grant, String address, String token) {}

    /** What a link opens, for a request without an account. */
    public record LinkAccess(ResourceRef resource, String title, String link, String level, Instant expires) {}

    private final KernelSharing sharing;
    private final SharedLinks links;
    private final UserAccounts accounts;
    private final Organizations organizations;
    private final SecurityIdentity identity;

    public SharingDialog(
            KernelSharing sharing,
            SharedLinks links,
            UserAccounts accounts,
            Organizations organizations,
            SecurityIdentity identity) {
        this.sharing = sharing;
        this.links = links;
        this.accounts = accounts;
        this.organizations = organizations;
        this.identity = identity;
    }

    /**
     * The resource, the level of the person of the request and what they may do.
     *
     * @throws AccessDeniedException concealed when they have no level on it
     */
    public ResourceView open(ResourceRef ref) {
        return call(() -> {
            ResourceTypeEntry type = sharing.typeOf(ref);
            RegisteredResource entry = sharing.entryOf(ref);
            String level =
                    sharing.level(ref).orElseThrow(() -> new AccessDeniedException("No level on " + ref + ".", true));
            return new ResourceView(
                    ref,
                    entry.getTitle(),
                    entry.getLink(),
                    entry.getOwnerId(),
                    level,
                    sharing.mayShare(ref),
                    type.levels().stream()
                            .map(found -> new LevelView(found.name(), found.title(), found.edits(), found.i18n()))
                            .toList(),
                    type.subjects().stream().sorted().map(SubjectKind::value).toList(),
                    type.linkLevel(),
                    type.accepts(SubjectKind.LINK) ? Instant.now().plus(sharing.linkMaxValidity()) : null);
        });
    }

    /** The grants of a resource, with the names of their subjects, for a person who may share it. */
    public List<GrantView> grants(ResourceRef ref) {
        return call(() -> sharing.grantsToShow(ref).stream().map(this::view).toList());
    }

    /** Grants a level to a subject, or replaces the level of its grant. */
    public GrantView grant(ResourceRef ref, String kind, UUID id, String level) {
        return call(() -> {
            if (kind == null || level == null) {
                throw new InvalidInputException(List.of("subject.kind and level are required"));
            }
            Subject subject =
                    switch (SubjectKind.fromValue(kind).orElse(null)) {
                        case PERSON -> Subject.person(required(id));
                        case GROUP -> Subject.group(required(id));
                        case ORGANIZATION -> Subject.organization();
                        case PUBLIC -> Subject.everyone();
                        case LINK ->
                            throw new InvalidInputException(List.of("subject.kind links are made with POST .../links"));
                        case null ->
                            throw new InvalidInputException(
                                    List.of("subject.kind must be person, group, organization or public"));
                    };
            Grant grant = sharing.grant(ref, subject, level);
            return view(sharing.grantsToShow(ref).stream()
                    .filter(found -> found.getId().equals(grant.id()))
                    .findFirst()
                    .orElseThrow());
        });
    }

    /** Makes a link; its secret is in the answer only. */
    public LinkView createLink(ResourceRef ref, String level, Instant expires, String password) {
        return call(() -> {
            if (level == null || expires == null) {
                throw new InvalidInputException(List.of("level and expires are required"));
            }
            KernelSharing.MadeLink made = sharing.createLink(ref, level, expires, password);
            return new LinkView(view(made.grant()), SharedLinks.address(made.secret()), made.secret());
        });
    }

    /** Revokes a grant or a link. */
    public void revoke(UUID grant) {
        call(() -> {
            sharing.revoke(grant);
            return null;
        });
    }

    /**
     * Opens a link, also without an account.
     *
     * @throws ResourceNotFoundException when the link is unknown, expired or revoked
     * @throws ForbiddenOperationException when its password is missing or wrong
     */
    public LinkAccess openLink(String token, String password) {
        String actor =
                identity.isAnonymous() ? "anonymous" : identity.getPrincipal().getName();
        try {
            SharedLinks.Opened opened = links.open(token, password, actor);
            return new LinkAccess(opened.resource(), opened.title(), opened.link(), opened.level(), opened.expires());
        } catch (SharedLinks.RefusedException e) {
            throw switch (e.refusal()) {
                case NOT_FOUND -> new ResourceNotFoundException("The link does not exist.");
                case PASSWORD_REQUIRED -> new ForbiddenOperationException("The link asks for a password.");
                case WRONG_PASSWORD -> new ForbiddenOperationException("The password of the link is wrong.");
            };
        }
    }

    private GrantView view(ResourceGrant grant) {
        SubjectView subject =
                switch (grant.kind()) {
                    case PERSON -> {
                        Optional<UserAccount> account = accounts.findById(grant.getAccountId());
                        yield new SubjectView(
                                "person",
                                grant.getAccountId(),
                                account.map(UserAccount::getDisplayName).orElse(null),
                                account.map(UserAccount::getUsername).orElse(null));
                    }
                    case GROUP ->
                        new SubjectView(
                                "group",
                                grant.getTeamId(),
                                sharing.team(grant.getTeamId())
                                        .map(Team::getName)
                                        .orElse(null),
                                null);
                    case ORGANIZATION ->
                        new SubjectView(
                                "organization",
                                null,
                                organizations
                                        .findById(grant.getOrganizationId())
                                        .map(Organization::getName)
                                        .orElse(null),
                                null);
                    case LINK -> new SubjectView("link", grant.getId(), null, null);
                    case PUBLIC -> new SubjectView("public", null, null, null);
                };
        boolean link = grant.kind() == SubjectKind.LINK;
        return new GrantView(
                grant.getId(),
                subject,
                grant.getLevel(),
                grant.getGrantedBy(),
                accounts.findById(grant.getGrantedBy())
                        .map(UserAccount::getDisplayName)
                        .orElse(null),
                grant.getGrantedAt(),
                link ? grant.getExpiresAt() : null,
                link ? grant.hasPassword() : null);
    }

    private static UUID required(UUID id) {
        if (id == null) {
            throw new InvalidInputException(List.of("subject.id is required for a person or a group"));
        }
        return id;
    }

    /** The errors of the extension API as problems of the REST API. */
    private static <T> T call(Supplier<T> action) {
        try {
            return action.get();
        } catch (NoSuchElementException e) {
            throw new ResourceNotFoundException(e.getMessage());
        } catch (IllegalArgumentException e) {
            throw new InvalidInputException(List.of("input " + e.getMessage()));
        }
    }
}
