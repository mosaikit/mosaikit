// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import com.fasterxml.jackson.annotation.JsonInclude;
import dev.mosaikit.kernel.api.extension.Contribution;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.FrontendEntry;
import dev.mosaikit.kernel.api.extension.FrontendIsolation;
import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.extension.SubjectKind;
import dev.mosaikit.kernel.api.permission.AccessDeniedException;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.sharing.Grant;
import dev.mosaikit.kernel.api.sharing.Subject;
import dev.mosaikit.kernel.core.account.UserAccount;
import dev.mosaikit.kernel.core.account.UserAccounts;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.ForbiddenOperationException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.extension.ExtensionAssetResource;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.FrontendExtensionView;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
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
import java.util.regex.Pattern;

/**
 * What the sharing dialog of the kernel shows and does (MK-055), for the REST API: the same dialog
 * for every resource type, on the {@link KernelSharing} bean that extensions call.
 */
@ApplicationScoped
@Transactional
public class SharingDialog {

    /**
     * The extension point of the element that shows a resource opened with a link, to people who may
     * have no account (MK-055): attributes {@code element} and, optionally, {@code type}, the resource
     * type it shows; without {@code type}, every type of the extension.
     */
    public static final String SHARED_VIEW_POINT = "shared.view";

    private static final Pattern CUSTOM_ELEMENT = Pattern.compile("^[a-z][a-z0-9]*+(?:-[a-z0-9]++)++$");

    /**
     * A level of a type.
     *
     * @param edits whether it lets people change the resource
     */
    public record LevelView(String name, String title, boolean edits, Map<String, Map<String, String>> i18n) {}

    /**
     * A resource as the dialog opens it.
     *
     * @param owner the account of the person who owns it, {@code null} when the organization owns it
     * @param ownerName the display name of that person
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
            String ownerName,
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
     * The accesses to a resource that come from a resource above it (MK-136), for a type that inherits
     * the levels of its parent: who owns that resource and its grants, at the levels of its type.
     *
     * @param resource the resource above, which the dialog names
     * @param owner the account of the person who owns it, {@code null} when the organization owns it
     * @param ownerName the display name of that person
     * @param levels the levels of its type, which its grants give
     * @param grants its grants that give something now, links included
     */
    public record InheritedView(
            ResourceRef resource,
            String title,
            String link,
            UUID owner,
            String ownerName,
            List<LevelView> levels,
            List<GrantView> grants) {}

    /**
     * A link just made.
     *
     * @param address the address to give to people, with the secret
     * @param token the secret alone: the kernel keeps only its hash, so it is shown this once
     */
    public record LinkView(GrantView grant, String address, String token) {}

    /**
     * The element of an extension that shows a resource opened with a link (MK-055), from its
     * contribution to {@value #SHARED_VIEW_POINT}: the shell loads the module of the frontend and
     * places the element, which calls the API of the extension with the link.
     *
     * @param extension the extension
     * @param version its version
     * @param entry the address of the module of its frontend
     * @param element the custom element
     */
    public record SharedView(String extension, String version, String entry, String element) {}

    /**
     * What a link opens, for a request without an account.
     *
     * @param view the element that shows the resource, or {@code null} when the extension offers none
     *     or its frontend runs isolated
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record LinkAccess(
            ResourceRef resource, String title, String link, String level, Instant expires, SharedView view) {}

    private final KernelSharing sharing;
    private final SharedLinks links;
    private final UserAccounts accounts;
    private final Organizations organizations;
    private final SecurityIdentity identity;
    private final ExtensionRegistry extensions;
    private final boolean isolateUnverified;

    public SharingDialog(
            KernelSharing sharing,
            SharedLinks links,
            UserAccounts accounts,
            Organizations organizations,
            SecurityIdentity identity,
            ExtensionRegistry extensions,
            KernelConfig config) {
        this.sharing = sharing;
        this.links = links;
        this.accounts = accounts;
        this.organizations = organizations;
        this.identity = identity;
        this.extensions = extensions;
        this.isolateUnverified =
                FrontendExtensionView.isolatesUnverified(config.extensions().unverifiedFrontends());
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
                    ownerName(entry.getOwnerId()),
                    level,
                    sharing.mayShare(ref),
                    levels(type),
                    type.subjects().stream().sorted().map(SubjectKind::value).toList(),
                    type.linkLevel(),
                    type.accepts(SubjectKind.LINK) ? Instant.now().plus(sharing.linkMaxValidity()) : null);
        });
    }

    /** The grants of a resource, with the names of their subjects, for a person who may share it. */
    public List<GrantView> grants(ResourceRef ref) {
        return call(() -> sharing.grantsToShow(ref).stream().map(this::view).toList());
    }

    /**
     * The accesses inherited from each resource above a resource (MK-136), from its parent upwards,
     * for a person who may share it; empty for a type that does not inherit.
     */
    public List<InheritedView> inherited(ResourceRef ref) {
        return call(() -> sharing.inheritedToShow(ref).stream()
                .map(above -> new InheritedView(
                        above.resource().ref(),
                        above.resource().getTitle(),
                        above.resource().getLink(),
                        above.resource().getOwnerId(),
                        ownerName(above.resource().getOwnerId()),
                        levels(above.type()),
                        above.grants().stream().map(this::view).toList()))
                .toList());
    }

    private String ownerName(UUID owner) {
        return owner == null
                ? null
                : accounts.findById(owner).map(UserAccount::getDisplayName).orElse(null);
    }

    private static List<LevelView> levels(ResourceTypeEntry type) {
        return type.levels().stream()
                .map(found -> new LevelView(found.name(), found.title(), found.edits(), found.i18n()))
                .toList();
    }

    /**
     * Grants a level to a subject, or replaces the level of its grant.
     *
     * @param id the account of a person or the team of a group
     * @param email for a person, their email address (username) in place of {@code id}
     */
    public GrantView grant(ResourceRef ref, String kind, UUID id, String email, String level) {
        return call(() -> {
            if (kind == null || level == null) {
                throw new InvalidInputException(List.of("subject.kind and level are required"));
            }
            Subject subject =
                    switch (SubjectKind.fromValue(kind).orElse(null)) {
                        case PERSON -> Subject.person(id != null ? id : person(email));
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
            return new LinkAccess(
                    opened.resource(),
                    opened.title(),
                    opened.link(),
                    opened.level(),
                    opened.expires(),
                    sharedView(opened.resource()).orElse(null));
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

    /**
     * The element that shows a resource of this type to the people who open its link: only for a
     * frontend that the shell loads as a module, never for one it isolates (MK-014), whose code would
     * otherwise run in the page of the installation for people without an account.
     */
    Optional<SharedView> sharedView(ResourceRef ref) {
        Optional<InstalledExtension> extension = extensions.findActive(ref.extension());
        if (extension.isEmpty()
                || extension.get().manifest().isEmpty()
                || (isolateUnverified && !extension.get().isVerified())) {
            return Optional.empty();
        }
        ExtensionManifest manifest = extension.get().manifest().get();
        Optional<FrontendEntry> frontend =
                manifest.frontend().filter(found -> found.isolation() == FrontendIsolation.MODULE);
        if (frontend.isEmpty()) {
            return Optional.empty();
        }
        return manifest.contributions().stream()
                .filter(contribution -> contribution.point().equals(SHARED_VIEW_POINT))
                .filter(contribution -> showsType(contribution, ref.type()))
                .map(contribution -> contribution.attributes().get("element"))
                .filter(element -> element instanceof String name
                        && CUSTOM_ELEMENT.matcher(name).matches())
                .map(element -> new SharedView(
                        manifest.id(),
                        manifest.version().toString(),
                        ExtensionAssetResource.assetUrl(
                                manifest.id(), frontend.get().entry()),
                        (String) element))
                .findFirst();
    }

    private static boolean showsType(Contribution contribution, String type) {
        Object declared = contribution.attributes().get("type");
        return declared == null || declared.equals(type);
    }

    /** The account of a person by email address: refused alike when there is none and when they are elsewhere. */
    private UUID person(String email) {
        if (email == null || email.isBlank()) {
            throw new InvalidInputException(List.of("subject.id or subject.email is required for a person"));
        }
        return accounts.findByUsername(email.strip().toLowerCase(java.util.Locale.ROOT))
                .map(UserAccount::getId)
                .orElseThrow(() ->
                        new IllegalArgumentException("The person " + email.strip() + " is not of the organization."));
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
