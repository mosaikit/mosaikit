// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.sharing;

import dev.mosaikit.kernel.api.context.NoOrganizationException;
import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.extension.SubjectKind;
import dev.mosaikit.kernel.api.permission.AccessDeniedException;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.sharing.Grant;
import dev.mosaikit.kernel.api.sharing.SharedLink;
import dev.mosaikit.kernel.api.sharing.Sharing;
import dev.mosaikit.kernel.api.sharing.Subject;
import dev.mosaikit.kernel.core.account.AccountDirectory;
import dev.mosaikit.kernel.core.apps.AppSettings;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.events.PlatformEventLog;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.organization.OrganizationMember;
import dev.mosaikit.kernel.core.organization.OrganizationMembers;
import dev.mosaikit.kernel.core.resources.RegisteredResource;
import dev.mosaikit.kernel.core.resources.RegisteredResources;
import dev.mosaikit.kernel.core.security.PasswordHasher;
import dev.mosaikit.kernel.core.security.Roles;
import dev.mosaikit.kernel.core.teams.Team;
import dev.mosaikit.kernel.core.teams.TeamMember;
import dev.mosaikit.kernel.core.teams.TeamRepository;
import io.agroal.api.AgroalDataSource;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * One sharing model for the resources of every extension (MK-055, ADR-0037), the kernel's
 * {@link Sharing} bean. Every call acts on the organization of the request and joins the transaction
 * of the caller; every grant, change of level and revocation is in the audit log, and so is every
 * use of a link ({@link SharedLinks}).
 *
 * <p>A documented exception of the API is thrown before anything is written, and leaves the transaction
 * of the caller usable (#126): an extension that catches it goes on writing in the same transaction.
 */
@ApplicationScoped
@Transactional(
        dontRollbackOn = {
            IllegalArgumentException.class,
            AccessDeniedException.class,
            NoSuchElementException.class,
            NoOrganizationException.class
        })
public class KernelSharing implements Sharing {

    static final String GRANTED = "sharing.granted";
    static final String REVOKED = "sharing.revoked";
    static final String LINK_CREATED = "sharing.link.created";
    static final String LINK_REVOKED = "sharing.link.revoked";

    /**
     * A link just made, with its secret, which the kernel does not keep.
     *
     * @param grant the grant of the link
     * @param secret the secret, to give once
     */
    public record MadeLink(ResourceGrant grant, ResourceRef resource, String secret) {}

    private final ResourceGrants grants;
    private final RegisteredResources entries;
    private final ExtensionRegistry extensions;
    private final RequestOrganization organization;
    private final SecurityIdentity identity;
    private final AccountDirectory directory;
    private final OrganizationMembers members;
    private final TeamRepository teams;
    private final AuditLog audit;
    private final PasswordHasher hasher;
    private final Duration linkMaxValidity;
    private final Clock clock;
    private final AgroalDataSource dataSource;
    private final AppSettings apps;
    private final PlatformEventLog events;

    public KernelSharing(
            ResourceGrants grants,
            RegisteredResources entries,
            ExtensionRegistry extensions,
            RequestOrganization organization,
            SecurityIdentity identity,
            AccountDirectory directory,
            OrganizationMembers members,
            TeamRepository teams,
            AuditLog audit,
            PasswordHasher hasher,
            KernelConfig config,
            Clock clock,
            AgroalDataSource dataSource,
            AppSettings apps,
            PlatformEventLog events) {
        this.grants = grants;
        this.entries = entries;
        this.extensions = extensions;
        this.organization = organization;
        this.identity = identity;
        this.directory = directory;
        this.members = members;
        this.teams = teams;
        this.audit = audit;
        this.hasher = hasher;
        this.linkMaxValidity = config.sharing().linkMaxValidity();
        this.clock = clock;
        this.dataSource = dataSource;
        this.apps = apps;
        this.events = events;
    }

    // --- Sharing -------------------------------------------------------------------------------

    @Override
    public Grant grant(ResourceRef resource, Subject subject, String level) {
        Objects.requireNonNull(subject, "subject");
        Objects.requireNonNull(level, "level");
        ResourceTypeEntry type = type(resource);
        if (subject instanceof Subject.Link) {
            throw new IllegalArgumentException("A link is made with createLink, not granted.");
        }
        grantable(type, subject.kind(), level);
        UUID org = organization.require();
        RegisteredResource entry = entry(org, resource);
        UUID me = sharer(type, entry, org, level);
        UUID account = null;
        UUID team = null;
        switch (subject) {
            case Subject.Person person -> {
                account = person.account();
                if (members.findByAccountIdAndOrganizationId(account, org).isEmpty()) {
                    throw new IllegalArgumentException("The person " + account + " is not of the organization.");
                }
            }
            case Subject.Group group -> {
                team = group.team();
                if (teams.findById(team)
                        .filter(found -> found.getOrganizationId().equals(org))
                        .isEmpty()) {
                    throw new IllegalArgumentException("The team " + team + " is not of the organization.");
                }
            }
            default -> {
                // The organization and the public name no one.
            }
        }
        Instant now = Instant.now(clock);
        UUID subjectAccount = account;
        UUID subjectTeam = team;
        Optional<ResourceGrant> existing = grants.of(org, entry.getId()).stream()
                .filter(found -> found.kind() == subject.kind()
                        && Objects.equals(found.getAccountId(), subjectAccount)
                        && Objects.equals(found.getTeamId(), subjectTeam))
                .findFirst();
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("subject", subject.kind().value());
        if (account != null || team != null) {
            detail.put("subjectId", String.valueOf(account != null ? account : team));
        }
        detail.put("level", level);
        ResourceGrant saved;
        if (existing.isPresent()) {
            saved = existing.get();
            String previous = saved.getLevel();
            detail.put("previousLevel", previous);
            saved.regrant(level, me, now);
            grants.update(saved);
            if (!previous.equals(level)) {
                raise(org, PlatformEvents.SHARING_CHANGED, resource, saved, previous);
            }
        } else {
            saved = ResourceGrant.of(org, entry.getId(), subject.kind(), account, team, level, me, now);
            grants.insert(saved);
            raise(org, PlatformEvents.SHARING_GRANTED, resource, saved, null);
        }
        audited(org, GRANTED, resource, detail);
        return view(saved, resource);
    }

    @Override
    public SharedLink createLink(ResourceRef resource, String level, Instant expires) {
        MadeLink made = createLink(resource, level, expires, null);
        return new SharedLink(view(made.grant(), resource), SharedLinks.address(made.secret()));
    }

    /**
     * Makes a link with an optional password, as the person of the request; see
     * {@link #createLink(ResourceRef, String, Instant)}.
     *
     * @param password the password the link asks for, or {@code null}; only its hash is kept
     */
    public MadeLink createLink(ResourceRef resource, String level, Instant expires, String password) {
        Objects.requireNonNull(level, "level");
        ResourceTypeEntry type = type(resource);
        grantable(type, SubjectKind.LINK, level);
        Instant now = Instant.now(clock);
        if (expires == null) {
            throw new IllegalArgumentException("A link always has an expiry.");
        }
        if (!expires.isAfter(now)) {
            throw new IllegalArgumentException("The expiry of a link must be in the future.");
        }
        if (expires.isAfter(now.plus(linkMaxValidity))) {
            throw new IllegalArgumentException("A link expires at the latest " + linkMaxValidity.toDays()
                    + " days after it is made, as the installation sets (mosaikit.sharing.link-max-validity).");
        }
        if (password != null && password.isBlank()) {
            password = null;
        }
        UUID org = organization.require();
        RegisteredResource entry = entry(org, resource);
        UUID me = sharer(type, entry, org, level);
        String secret = SharedLinks.secret();
        ResourceGrant link = ResourceGrant.link(
                org,
                entry.getId(),
                level,
                me,
                now,
                SharedLinks.digest(secret),
                expires,
                password == null ? null : hasher.hash(password.toCharArray()));
        grants.insert(link);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("link", link.getId().toString());
        detail.put("level", level);
        detail.put("expires", expires.toString());
        detail.put("password", password != null);
        audited(org, LINK_CREATED, resource, detail);
        raise(org, PlatformEvents.SHARING_GRANTED, resource, link, null);
        return new MadeLink(link, resource, secret);
    }

    @Override
    public void revoke(UUID grant) {
        Objects.requireNonNull(grant, "grant");
        UUID org = organization.require();
        Optional<ResourceGrant> found =
                grants.findById(grant).filter(g -> g.getOrganizationId().equals(org));
        if (found.isEmpty() || found.get().getRevokedAt() != null) {
            return;
        }
        ResourceGrant revoked = found.get();
        RegisteredResource entry = entries.findById(revoked.getResourceId()).orElseThrow();
        ResourceRef ref = entry.ref();
        ResourceTypeEntry type = type(ref);
        sharer(type, entry, org, revoked.getLevel());
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("subject", revoked.kind().value());
        if (revoked.getAccountId() != null || revoked.getTeamId() != null) {
            detail.put(
                    "subjectId",
                    String.valueOf(revoked.getAccountId() != null ? revoked.getAccountId() : revoked.getTeamId()));
        }
        detail.put("level", revoked.getLevel());
        if (revoked.kind() == SubjectKind.LINK) {
            // A revoked link is kept, so that it answers not found and its uses stay explained.
            revoked.revoke(Instant.now(clock));
            grants.update(revoked);
            detail.put("link", revoked.getId().toString());
            audited(org, LINK_REVOKED, ref, detail);
        } else {
            grants.delete(revoked);
            audited(org, REVOKED, ref, detail);
        }
        raise(org, PlatformEvents.SHARING_REVOKED, ref, revoked, null);
    }

    @Override
    public List<Grant> grants(ResourceRef resource) {
        type(resource);
        Optional<UUID> org = organization.id();
        if (org.isEmpty()) {
            return List.of();
        }
        return entries.find(org.get(), resource.extension(), resource.type(), resource.id())
                .map(entry -> liveGrants(org.get(), entry).stream()
                        .map(grant -> view(grant, resource))
                        .toList())
                .orElse(List.of());
    }

    @Override
    public Optional<String> level(ResourceRef resource) {
        ResourceTypeEntry type = type(resource);
        Optional<SharedLinks.Opened> link = LinkRequest.current();
        Optional<UUID> org = organization.id();
        if (org.isEmpty()) {
            // A request without an organization: only the link it was opened with gives a level, and
            // from now on the request acts on the organization of that resource (admit).
            return link.filter(found -> found.resource().equals(resource))
                    .filter(found -> admit(found.organization(), resource.extension()))
                    .map(SharedLinks.Opened::level);
        }
        Optional<RegisteredResource> entry =
                entries.find(org.get(), resource.extension(), resource.type(), resource.id());
        if (entry.isEmpty()) {
            return Optional.empty();
        }
        UUID linkId = link.filter(
                        opened -> opened.resourceId().equals(entry.get().getId()))
                .map(SharedLinks.Opened::grant)
                .orElse(null);
        return Reach.level(
                type,
                entry.get().getOwnerId(),
                requestViewer(org.get(), linkId),
                grants.of(org.get(), entry.get().getId()),
                Instant.now(clock));
    }

    @Override
    public Optional<String> level(UUID person, ResourceRef resource) {
        Objects.requireNonNull(person, "person");
        ResourceTypeEntry type = type(resource);
        UUID org = organization.require();
        return entries.find(org, resource.extension(), resource.type(), resource.id())
                .flatMap(entry -> Reach.level(
                        type,
                        entry.getOwnerId(),
                        personViewer(org, person),
                        grants.of(org, entry.getId()),
                        Instant.now(clock)));
    }

    @Override
    public boolean allows(ResourceRef resource, String level) {
        ResourceTypeEntry type = declaredLevel(resource, level);
        return level(resource).map(held -> type.includes(held, level)).orElse(false);
    }

    @Override
    public boolean allows(UUID person, ResourceRef resource, String level) {
        ResourceTypeEntry type = declaredLevel(resource, level);
        return level(person, resource).map(held -> type.includes(held, level)).orElse(false);
    }

    @Override
    public Set<String> visible(String extension, String type, String level) {
        Objects.requireNonNull(extension, "extension");
        Objects.requireNonNull(type, "type");
        ResourceTypeEntry entry = declaredLevel(new ResourceRef(extension, type, "-"), level);
        Optional<SharedLinks.Opened> link = LinkRequest.current();
        Optional<UUID> org = organization.id();
        if (org.isEmpty()) {
            return link.filter(opened -> opened.resource().extension().equals(extension)
                            && opened.resource().type().equals(type)
                            && entry.includes(opened.level(), level))
                    .map(opened -> Set.of(opened.resource().id()))
                    .orElse(Set.of());
        }
        return visible(org.get(), entry, extension, type, level, linkId -> requestViewer(org.get(), linkId), link);
    }

    @Override
    public Set<String> visible(UUID person, String extension, String type, String level) {
        Objects.requireNonNull(person, "person");
        Objects.requireNonNull(extension, "extension");
        Objects.requireNonNull(type, "type");
        ResourceTypeEntry entry = declaredLevel(new ResourceRef(extension, type, "-"), level);
        UUID org = organization.require();
        Reach.Viewer viewer = personViewer(org, person);
        return visible(org, entry, extension, type, level, _ -> viewer, Optional.empty());
    }

    private Set<String> visible(
            UUID org,
            ResourceTypeEntry type,
            String extension,
            String typeName,
            String level,
            java.util.function.Function<UUID, Reach.Viewer> viewers,
            Optional<SharedLinks.Opened> link) {
        List<RegisteredResource> all = entries.list(org, extension, typeName);
        if (all.isEmpty()) {
            return Set.of();
        }
        Map<UUID, List<ResourceGrant>> byResource = new HashMap<>();
        grants.ofAll(org, all.stream().map(RegisteredResource::getId).toList())
                .forEach(grant -> byResource
                        .computeIfAbsent(grant.getResourceId(), _ -> new java.util.ArrayList<>())
                        .add(grant));
        Instant now = Instant.now(clock);
        Reach.Viewer plain = viewers.apply(null);
        return all.stream()
                .filter(entry -> {
                    Reach.Viewer viewer = link.filter(
                                    opened -> opened.resourceId().equals(entry.getId()))
                            .map(opened -> viewers.apply(opened.grant()))
                            .orElse(plain);
                    return Reach.level(
                                    type,
                                    entry.getOwnerId(),
                                    viewer,
                                    byResource.getOrDefault(entry.getId(), List.of()),
                                    now)
                            .map(held -> type.includes(held, level))
                            .orElse(false);
                })
                .map(RegisteredResource::getRefId)
                .collect(Collectors.toUnmodifiableSet());
    }

    /**
     * Lets a request without an account, opened with a link that gives a level on a resource, act on
     * the organization of the resource (MK-055): the extension asked {@code Sharing} about the
     * resource of the link and got a level, so it may now read it under the row-level security of
     * that organization. The connection that the request may hold already gets the organization too.
     * Not when the organization turned the apps of the extension off (MK-030): its links then open
     * nothing, as its API refuses its own people.
     *
     * @return whether the request acts on the organization of the link
     */
    private boolean admit(UUID org, String extension) {
        if (!organization.admitLink(org)) {
            return false;
        }
        organizationOfConnection(org.toString());
        if (apps.isOff(org, extension)) {
            organization.forgetLink();
            organizationOfConnection("");
            return false;
        }
        return true;
    }

    private void organizationOfConnection(String org) {
        try (Connection connection = dataSource.getConnection();
                PreparedStatement statement =
                        connection.prepareStatement("select set_config('mosaikit.organization', ?, false)")) {
            statement.setString(1, org);
            statement.execute();
        } catch (SQLException e) {
            throw new IllegalStateException("Cannot act on the organization of the link", e);
        }
    }

    // --- For the REST API of the kernel ---------------------------------------------------------

    /** The type of a resource, checked against the active extension that declares it. */
    public ResourceTypeEntry typeOf(ResourceRef resource) {
        return type(resource);
    }

    /** The entry of a registered resource of the organization of the request. */
    public RegisteredResource entryOf(ResourceRef resource) {
        type(resource);
        return entry(organization.require(), resource);
    }

    /** Whether the person of the request may share the resource. */
    public boolean mayShare(ResourceRef resource) {
        ResourceTypeEntry type = type(resource);
        UUID org = organization.require();
        RegisteredResource entry = entry(org, resource);
        return shares(type, entry, org);
    }

    /**
     * The grants of a resource that give something now, as the sharing dialog lists them, for a
     * person who may share it.
     *
     * @throws AccessDeniedException when the person of the request may not share it
     */
    public List<ResourceGrant> grantsToShow(ResourceRef resource) {
        ResourceTypeEntry type = type(resource);
        UUID org = organization.require();
        RegisteredResource entry = entry(org, resource);
        if (!shares(type, entry, org)) {
            throw denied(type, entry, org);
        }
        return liveGrants(org, entry);
    }

    /**
     * Shares a resource that the kernel keeps for an extension, such as a document of a collection
     * shared with a team (MK-032), with a team at a level, as the person of the request: the kernel
     * decides it, so who shares is not checked. Audited as every grant.
     */
    public void shareWithTeam(ResourceRef resource, UUID team, String level) {
        ResourceTypeEntry type = type(resource);
        grantable(type, SubjectKind.GROUP, level);
        UUID org = organization.require();
        RegisteredResource entry = entry(org, resource);
        UUID me = me().orElseThrow(() -> new AccessDeniedException("Sign in to share.", false));
        ResourceGrant shared =
                ResourceGrant.of(org, entry.getId(), SubjectKind.GROUP, null, team, level, me, Instant.now(clock));
        grants.insert(shared);
        raise(org, PlatformEvents.SHARING_GRANTED, resource, shared, null);
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("subject", SubjectKind.GROUP.value());
        detail.put("subjectId", team.toString());
        detail.put("level", level);
        audited(org, GRANTED, resource, detail);
    }

    /** The longest validity of a link. */
    public Duration linkMaxValidity() {
        return linkMaxValidity;
    }

    // --- Rules ---------------------------------------------------------------------------------

    /**
     * The account of the person of the request, who may share the resource at this level: the
     * owner, an administrator of the organization, or a person who holds the highest level through
     * a grant to them, a group of theirs or the organization; never above their own level.
     */
    private UUID sharer(ResourceTypeEntry type, RegisteredResource entry, UUID org, String level) {
        UUID me = me().orElseThrow(() -> new AccessDeniedException("Sign in to share.", false));
        if (!shares(type, entry, org)) {
            throw denied(type, entry, org);
        }
        String own = Reach.level(
                        type,
                        entry.getOwnerId(),
                        requestViewer(org, null),
                        grants.of(org, entry.getId()),
                        Instant.now(clock))
                .orElseThrow();
        if (!type.includes(own, level)) {
            throw new AccessDeniedException("You cannot share " + entry.ref() + " above your level " + own + ".");
        }
        return me;
    }

    /**
     * Whether the person of the request shares the resource. Links and the public are left out: a
     * level they give never lets anyone share, also for a type with one level.
     */
    private boolean shares(ResourceTypeEntry type, RegisteredResource entry, UUID org) {
        if (me().isEmpty()) {
            return false;
        }
        List<ResourceGrant> personal = grants.of(org, entry.getId()).stream()
                .filter(grant -> grant.kind() != SubjectKind.LINK && grant.kind() != SubjectKind.PUBLIC)
                .toList();
        return Reach.level(type, entry.getOwnerId(), requestViewer(org, null), personal, Instant.now(clock))
                .filter(type.levelNames().getLast()::equals)
                .isPresent();
    }

    /** Refused: {@code 403} with a level on the resource, {@code 404} without. */
    private AccessDeniedException denied(ResourceTypeEntry type, RegisteredResource entry, UUID org) {
        boolean seen = Reach.level(
                        type,
                        entry.getOwnerId(),
                        requestViewer(org, null),
                        grants.of(org, entry.getId()),
                        Instant.now(clock))
                .isPresent();
        return new AccessDeniedException("You may not share " + entry.ref() + ".", !seen);
    }

    private static void grantable(ResourceTypeEntry type, SubjectKind kind, String level) {
        if (!type.declares(level)) {
            throw new IllegalArgumentException("The type " + type.type() + " has no level " + level + ".");
        }
        if (!type.accepts(kind)) {
            throw new IllegalArgumentException(
                    "The type " + type.type() + " is not shared with the subject " + kind.value() + ".");
        }
        if (!type.grantable(kind, level)) {
            throw new IllegalArgumentException("The subject " + kind.value() + " gets at most the level "
                    + type.highestLevelFor(kind) + " of " + type.type() + ".");
        }
    }

    private List<ResourceGrant> liveGrants(UUID org, RegisteredResource entry) {
        Instant now = Instant.now(clock);
        return grants.of(org, entry.getId()).stream()
                .filter(grant -> grant.live(now))
                .toList();
    }

    private Reach.Viewer requestViewer(UUID org, UUID link) {
        Optional<UUID> account = me();
        Set<UUID> teamIds = account.map(id -> teamsOf(id, org)).orElse(Set.of());
        return new Reach.Viewer(
                account.orElse(null),
                account.isPresent(),
                RequestOrganization.administrator(identity),
                RequestOrganization.guest(identity),
                teamIds,
                link);
    }

    private Reach.Viewer personViewer(UUID org, UUID person) {
        Optional<OrganizationMember> member = members.findByAccountIdAndOrganizationId(person, org);
        Set<String> roles = member.map(OrganizationMember::getRoles).orElse(Set.of());
        boolean administrator = roles.contains(Roles.ORGANIZATION_ADMIN);
        boolean guest =
                roles.contains(Roles.ORGANIZATION_GUEST) && !roles.contains(Roles.ORGANIZATION_USER) && !administrator;
        return new Reach.Viewer(
                person,
                member.isPresent(),
                administrator,
                guest,
                member.isPresent() ? teamsOf(person, org) : Set.of(),
                null);
    }

    private Set<UUID> teamsOf(UUID account, UUID org) {
        return teams.membershipsIn(account, org).stream()
                .map(TeamMember::getTeamId)
                .collect(Collectors.toUnmodifiableSet());
    }

    private Optional<UUID> me() {
        if (identity == null || identity.isAnonymous()) {
            return Optional.empty();
        }
        return RequestOrganization.account(identity)
                .or(() -> directory.idOf(identity.getPrincipal().getName()));
    }

    /** Refuses a reference of a type that the named extension does not declare, or of no active extension. */
    private ResourceTypeEntry type(ResourceRef ref) {
        Objects.requireNonNull(ref, "resource");
        ExtensionManifest manifest = extensions
                .findActive(ref.extension())
                .flatMap(InstalledExtension::manifest)
                .orElseThrow(() -> new IllegalArgumentException(ref.extension() + " is not an active extension."));
        return ResourceTypes.of(manifest, ref.type())
                .orElseThrow(() -> new IllegalArgumentException("The extension " + ref.extension()
                        + " does not declare the resource type " + ref.type() + "."));
    }

    private ResourceTypeEntry declaredLevel(ResourceRef ref, String level) {
        Objects.requireNonNull(level, "level");
        ResourceTypeEntry type = type(ref);
        if (!type.declares(level)) {
            throw new IllegalArgumentException("The type " + ref.type() + " has no level " + level + ".");
        }
        return type;
    }

    private RegisteredResource entry(UUID org, ResourceRef ref) {
        return entries.find(org, ref.extension(), ref.type(), ref.id())
                .orElseThrow(() -> new NoSuchElementException("The resource " + ref + " is not registered."));
    }

    /**
     * Raises an event of the platform for a grant made, changed or revoked (MK-085), so that extensions
     * that translate grants into the rules of other servers follow it. Never the secret of a link.
     */
    private void raise(UUID org, String type, ResourceRef ref, ResourceGrant grant, String previousLevel) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("extension", ref.extension());
        payload.put("type", ref.type());
        payload.put("id", ref.id());
        payload.put("grant", grant.getId().toString());
        payload.put("subject", grant.kind().value());
        if (grant.getAccountId() != null) {
            payload.put("subjectId", grant.getAccountId().toString());
        } else if (grant.getTeamId() != null) {
            payload.put("subjectId", grant.getTeamId().toString());
        }
        payload.put("level", grant.getLevel());
        if (previousLevel != null) {
            payload.put("previousLevel", previousLevel);
        }
        events.raise(org, type, payload);
    }

    private void audited(UUID org, String action, ResourceRef ref, Map<String, ?> detail) {
        audit.append(
                identity.getPrincipal().getName(),
                Optional.of(org),
                action,
                ref.toString(),
                AuditEvent.Outcome.SUCCEEDED,
                detail);
    }

    /** The grant as the API shows it. */
    static Grant view(ResourceGrant grant, ResourceRef resource) {
        Subject subject =
                switch (grant.kind()) {
                    case PERSON -> Subject.person(grant.getAccountId());
                    case GROUP -> Subject.group(grant.getTeamId());
                    case ORGANIZATION -> Subject.organization();
                    case PUBLIC -> Subject.everyone();
                    case LINK -> new Subject.Link(grant.getId(), grant.getExpiresAt());
                };
        return new Grant(
                grant.getId(), resource, subject, grant.getLevel(), grant.getGrantedBy(), grant.getGrantedAt());
    }

    /** A team, for the names of the sharing dialog. */
    Optional<Team> team(UUID id) {
        return teams.findById(id);
    }
}
