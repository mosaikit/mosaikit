// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.permissions;

import com.fasterxml.jackson.annotation.JsonInclude;
import dev.mosaikit.kernel.api.extension.PermissionEntry;
import dev.mosaikit.kernel.api.permission.PermissionId;
import dev.mosaikit.kernel.core.account.UserAccount;
import dev.mosaikit.kernel.core.account.UserAccounts;
import dev.mosaikit.kernel.core.apps.AppPermissions;
import dev.mosaikit.kernel.core.apps.AppSettings;
import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.ExtensionsLoaded;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.organization.OrganizationMember;
import dev.mosaikit.kernel.core.organization.OrganizationMembers;
import dev.mosaikit.kernel.core.permissions.PermissionResolver.Effective;
import dev.mosaikit.kernel.core.permissions.PermissionResolver.Holder;
import dev.mosaikit.kernel.core.permissions.PermissionResolver.Source;
import dev.mosaikit.kernel.core.permissions.PermissionResolver.Standing;
import dev.mosaikit.kernel.core.security.Roles;
import dev.mosaikit.kernel.core.teams.Team;
import dev.mosaikit.kernel.core.teams.TeamRepository;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;
import org.jboss.logging.Logger;

/**
 * What the administrators of an organization do with permissions (MK-056): profiles, the profile of
 * each member, grants to teams and personal exceptions, and what a person, real or proposed, holds
 * and why. Every call acts on the organization given, which the caller has checked is the one of
 * the request; every change is in the audit log.
 */
@ApplicationScoped
@Transactional
public class PermissionAdministration {

    private static final Logger LOG = Logger.getLogger(PermissionAdministration.class);

    static final int MAX_NAME = 100;
    static final int MAX_DESCRIPTION = 500;

    /** The roles a profile can be the default of: only members get profiles. */
    static final Set<String> PROFILE_ROLES = Set.of(PermissionResolver.MEMBER_ROLE);

    /** The roles of a proposed member in a preview. */
    static final Set<String> PREVIEW_ROLES =
            Set.of(Roles.ORGANIZATION_ADMIN, Roles.ORGANIZATION_USER, Roles.ORGANIZATION_GUEST);

    /**
     * A permission of an active extension, and whether its apps are off for the organization.
     *
     * @param app the app that the permission opens, for the permission of an app (MK-030); {@code
     *     null} for a permission of the manifest
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record DeclaredView(
            String id,
            String extension,
            String extensionName,
            String name,
            String title,
            String description,
            Map<String, Map<String, String>> i18n,
            boolean off,
            String app) {}

    /** A profile with its permissions, by qualified identifier. */
    public record ProfileView(
            UUID id, String name, String description, String defaultForRole, List<String> permissions) {}

    /** What a profile is made of, to create or change it. */
    public record ProfileRequest(String name, String description, String defaultForRole, List<String> permissions) {}

    /** The name of a profile, where a profile is referred to. */
    public record ProfileRef(UUID id, String name) {
        static ProfileRef of(PermissionProfile profile) {
            return new ProfileRef(profile.getId(), profile.getName());
        }
    }

    /** The permissions granted to a team. */
    public record TeamView(UUID id, String name, List<String> permissions) {}

    /**
     * A permission that a person holds, or that something grants them while the apps of its extension
     * are off.
     *
     * @param granted whether the person holds it
     * @param withheld why it is not held although granted: {@code apps-off}; {@code null} otherwise
     * @param sources what grants it
     */
    public record EffectiveView(
            String id,
            String extension,
            String name,
            String title,
            boolean granted,
            String withheld,
            List<Source> sources) {}

    /**
     * The permissions of a member of the organization, and where each comes from.
     *
     * @param standing {@code administrator}, {@code member} or {@code guest}
     * @param profile the profile that applies: the one assigned, or the default of the role
     * @param profileAssigned whether the profile was assigned to the member, rather than the default
     * @param exceptions the personal exceptions of the member
     */
    public record MemberView(
            String email,
            String standing,
            ProfileRef profile,
            boolean profileAssigned,
            List<String> exceptions,
            List<EffectiveView> permissions) {}

    /** A proposed member: role, profile and teams, for a preview. */
    public record PreviewRequest(String role, UUID profile, List<UUID> teams) {}

    /** What a proposed member would hold. */
    public record PreviewView(String standing, ProfileRef profile, List<EffectiveView> permissions) {}

    /** The profile to assign to a member; {@code null} goes back to the default of the role. */
    public record Assignment(UUID profile) {}

    private final PermissionRepository repository;
    private final PermissionResolver resolver;
    private final PermissionCatalog catalog;
    private final AppSettings apps;
    private final TeamRepository teams;
    private final UserAccounts accounts;
    private final OrganizationMembers members;
    private final AuditLog audit;
    private final SecurityIdentity identity;
    private final Clock clock;

    @Inject
    public PermissionAdministration(
            PermissionRepository repository,
            PermissionResolver resolver,
            PermissionCatalog catalog,
            AppSettings apps,
            TeamRepository teams,
            UserAccounts accounts,
            OrganizationMembers members,
            AuditLog audit,
            SecurityIdentity identity) {
        this.repository = repository;
        this.resolver = resolver;
        this.catalog = catalog;
        this.apps = apps;
        this.teams = teams;
        this.accounts = accounts;
        this.members = members;
        this.audit = audit;
        this.identity = identity;
        this.clock = Clock.systemUTC();
    }

    // Declared permissions.

    /** The permissions of the active extensions, with whether their apps are off for the organization. */
    public List<DeclaredView> declared(UUID organization) {
        Map<String, Boolean> off = new HashMap<>();
        return catalog.all().stream()
                .map(declared -> new DeclaredView(
                        declared.id(),
                        declared.extension(),
                        declared.extensionName(),
                        declared.name(),
                        declared.title(),
                        declared.description(),
                        declared.i18n(),
                        off.computeIfAbsent(declared.extension(), extension -> apps.isOff(organization, extension)),
                        declared.app()))
                .toList();
    }

    // Profiles.

    public List<ProfileView> profiles(UUID organization) {
        List<PermissionProfile> found = repository.profiles(organization);
        if (found.isEmpty()) {
            return List.of();
        }
        Map<UUID, List<String>> granted = new HashMap<>();
        repository
                .ofProfiles(
                        organization,
                        found.stream().map(PermissionProfile::getId).toList())
                .forEach(grant -> granted.computeIfAbsent(grant.getProfileId(), _ -> new ArrayList<>())
                        .add(grant.permissionId().toString()));
        return found.stream()
                .map(profile -> view(profile, granted.getOrDefault(profile.getId(), List.of())))
                .toList();
    }

    public ProfileView profile(UUID organization, UUID id) {
        PermissionProfile profile = requireProfile(organization, id);
        return view(profile, permissionsOf(organization, profile.getId()));
    }

    public ProfileView createProfile(UUID organization, ProfileRequest request) {
        Checked checked = check(organization, request, null);
        Instant now = Instant.now(clock);
        checked.defaultForRole().ifPresent(role -> unsetDefault(organization, role, null, now));
        PermissionProfile profile = new PermissionProfile(
                organization,
                checked.name(),
                checked.description(),
                checked.defaultForRole().orElse(null),
                now);
        repository.insert(profile);
        checked.permissions()
                .forEach(permission ->
                        repository.insert(PermissionGrant.toProfile(organization, profile.getId(), permission, now)));
        List<String> permissions = ids(checked.permissions());
        record(
                organization,
                "permissions.profile.created",
                "profile/" + profile.getId(),
                Map.of(
                        "name", profile.getName(),
                        "defaultForRole", checked.defaultForRole().orElse(""),
                        "permissions", permissions));
        return view(profile, permissions);
    }

    public ProfileView changeProfile(UUID organization, UUID id, ProfileRequest request) {
        PermissionProfile profile = requireProfile(organization, id);
        Checked checked = check(organization, request, id);
        Instant now = Instant.now(clock);
        checked.defaultForRole().ifPresent(role -> unsetDefault(organization, role, id, now));
        profile.change(
                checked.name(), checked.description(), checked.defaultForRole().orElse(null), now);
        repository.update(profile);
        Map<PermissionId, PermissionGrant> existing = new LinkedHashMap<>();
        repository.ofProfile(organization, id).forEach(grant -> existing.put(grant.permissionId(), grant));
        List<String> added = new ArrayList<>();
        List<String> removed = new ArrayList<>();
        for (PermissionId permission : checked.permissions()) {
            if (existing.remove(permission) == null) {
                repository.insert(PermissionGrant.toProfile(organization, id, permission, now));
                added.add(permission.toString());
            }
        }
        // What is left was in the profile and is no longer: also the permissions of extensions that
        // are not active now, since the administrator saved the profile without them.
        existing.forEach((permission, grant) -> {
            repository.delete(grant);
            removed.add(permission.toString());
        });
        record(
                organization,
                "permissions.profile.changed",
                "profile/" + id,
                Map.of(
                        "name",
                        profile.getName(),
                        "defaultForRole",
                        checked.defaultForRole().orElse(""),
                        "added",
                        added,
                        "removed",
                        removed));
        return view(profile, permissionsOf(organization, id));
    }

    public void deleteProfile(UUID organization, UUID id) {
        PermissionProfile profile = requireProfile(organization, id);
        repository.delete(profile);
        record(organization, "permissions.profile.deleted", "profile/" + id, Map.of("name", profile.getName()));
    }

    // Members.

    /** Assigns a profile to a member, or, with {@code null}, gives them back the default of their role. */
    public MemberView assign(UUID organization, String email, UUID profileId) {
        OrganizationMember member = requireMember(organization, email);
        if (Standing.of(member.getRoles()) == Standing.GUEST) {
            throw new InvalidInputException(
                    List.of("profile a guest has no profile: grant permissions to their teams or as exceptions"));
        }
        Instant now = Instant.now(clock);
        Optional<MemberProfile> existing = repository.memberProfile(organization, member.getAccountId());
        String name = "";
        if (profileId == null) {
            existing.ifPresent(repository::delete);
        } else {
            PermissionProfile profile = requireProfile(organization, profileId);
            name = profile.getName();
            if (existing.isPresent()) {
                existing.get().assign(profileId, now);
                repository.update(existing.get());
            } else {
                repository.insert(new MemberProfile(organization, member.getAccountId(), profileId, now));
            }
        }
        record(
                organization,
                "permissions.profile.assigned",
                normalize(email),
                Map.of("profile", profileId == null ? "" : profileId.toString(), "name", name));
        return member(organization, email);
    }

    /** The permissions of a member, with where each comes from. */
    public MemberView member(UUID organization, String email) {
        OrganizationMember member = requireMember(organization, email);
        Standing standing = Standing.of(member.getRoles());
        Effective effective = resolver.effective(organization, Holder.of(standing, member.getAccountId()));
        boolean assigned = standing == Standing.MEMBER
                && repository.memberProfile(organization, member.getAccountId()).isPresent();
        List<String> exceptions = repository.ofMember(organization, member.getAccountId()).stream()
                .map(grant -> grant.permissionId().toString())
                .toList();
        return new MemberView(
                normalize(email),
                standing.name().toLowerCase(Locale.ROOT),
                effective.profile().map(ProfileRef::of).orElse(null),
                assigned,
                exceptions,
                views(effective));
    }

    public MemberView grantException(UUID organization, String email, String permission) {
        OrganizationMember member = requireMember(organization, email);
        PermissionId id = declared("permission", permission);
        boolean exists = repository.ofMember(organization, member.getAccountId()).stream()
                .anyMatch(grant -> grant.permissionId().equals(id));
        if (!exists) {
            repository.insert(PermissionGrant.toMember(organization, member.getAccountId(), id, Instant.now(clock)));
            record(
                    organization,
                    "permissions.exception.granted",
                    normalize(email),
                    Map.of("permission", id.toString()));
        }
        return member(organization, email);
    }

    public MemberView revokeException(UUID organization, String email, String permission) {
        OrganizationMember member = requireMember(organization, email);
        PermissionId id = parse("permission", permission);
        repository.ofMember(organization, member.getAccountId()).stream()
                .filter(grant -> grant.permissionId().equals(id))
                .forEach(grant -> {
                    repository.delete(grant);
                    record(
                            organization,
                            "permissions.exception.revoked",
                            normalize(email),
                            Map.of("permission", id.toString()));
                });
        return member(organization, email);
    }

    // Teams.

    public TeamView team(UUID organization, UUID teamId) {
        Team team = requireTeam(organization, teamId);
        return new TeamView(
                team.getId(),
                team.getName(),
                ids(repository.ofTeams(organization, List.of(teamId)).stream()
                        .map(PermissionGrant::permissionId)
                        .toList()));
    }

    public TeamView grantTeam(UUID organization, UUID teamId, String permission) {
        Team team = requireTeam(organization, teamId);
        PermissionId id = declared("permission", permission);
        boolean exists = repository.ofTeams(organization, List.of(teamId)).stream()
                .anyMatch(grant -> grant.permissionId().equals(id));
        if (!exists) {
            repository.insert(PermissionGrant.toTeam(organization, teamId, id, Instant.now(clock)));
            record(
                    organization,
                    "permissions.team.granted",
                    "team/" + teamId,
                    Map.of("team", team.getName(), "permission", id.toString()));
        }
        return team(organization, teamId);
    }

    public TeamView revokeTeam(UUID organization, UUID teamId, String permission) {
        Team team = requireTeam(organization, teamId);
        PermissionId id = parse("permission", permission);
        repository.ofTeams(organization, List.of(teamId)).stream()
                .filter(grant -> grant.permissionId().equals(id))
                .forEach(grant -> {
                    repository.delete(grant);
                    record(
                            organization,
                            "permissions.team.revoked",
                            "team/" + teamId,
                            Map.of("team", team.getName(), "permission", id.toString()));
                });
        return team(organization, teamId);
    }

    // Preview.

    /**
     * What a proposed member would hold with a role, a profile and teams, for an invitation: changes
     * nothing and writes nothing in the audit log.
     */
    public PreviewView preview(UUID organization, PreviewRequest request) {
        List<String> problems = new ArrayList<>();
        String role = request == null ? null : request.role();
        if (role == null || !PREVIEW_ROLES.contains(role)) {
            problems.add("role must be one of " + new TreeSet<>(PREVIEW_ROLES));
        }
        if (!problems.isEmpty()) {
            throw new InvalidInputException(problems);
        }
        Standing standing = Standing.of(Set.of(role));
        Optional<UUID> profile = Optional.ofNullable(request.profile());
        if (profile.isPresent()) {
            if (standing == Standing.GUEST) {
                throw new InvalidInputException(List.of("profile a guest has no profile"));
            }
            requireProfile(organization, profile.get());
        }
        List<UUID> proposedTeams =
                request.teams() == null ? List.of() : List.copyOf(new LinkedHashSet<>(request.teams()));
        proposedTeams.forEach(team -> requireTeam(organization, team));
        Effective effective =
                resolver.effective(organization, new Holder(standing, null, profile, Optional.of(proposedTeams)));
        return new PreviewView(
                standing.name().toLowerCase(Locale.ROOT),
                standing == Standing.MEMBER
                        ? effective.profile().map(ProfileRef::of).orElse(null)
                        : null,
                views(effective));
    }

    // Extensions that change.

    /**
     * Removes, in every organization, the grants of permissions that the installed extensions no
     * longer declare, and of extensions no longer installed, so that a permission an update brings
     * back arrives switched off. Runs as the owner of the tables, outside requests.
     *
     * @param installed every extension found in the installation, by identifier, with its declared
     *     permissions, or empty when its manifest cannot be read (its grants are then kept). When none
     *     is found nothing is removed: a missing or misconfigured extensions directory must not wipe
     *     the grants of every organization.
     * @return how many grants were removed
     */
    public int forgetUndeclared(Map<String, Optional<Set<String>>> installed) {
        if (installed.isEmpty()) {
            LOG.warn("No extension found in the installation: the grants of permissions are kept");
            return 0;
        }
        int removed = repository.deleteAllExcept(List.copyOf(installed.keySet()));
        for (Map.Entry<String, Optional<Set<String>>> extension : installed.entrySet()) {
            if (extension.getValue().isEmpty()) {
                continue;
            }
            Set<String> declared = extension.getValue().get();
            removed += declared.isEmpty()
                    ? repository.deleteOf(extension.getKey())
                    : repository.deleteUndeclared(extension.getKey(), List.copyOf(declared));
        }
        if (removed > 0) {
            LOG.infof("Removed %d grants of permissions that the extensions no longer declare", removed);
        }
        return removed;
    }

    void onExtensionsLoaded(@Observes ExtensionsLoaded event, ExtensionRegistry registry) {
        forgetUndeclared(registry.all());
    }

    /**
     * {@link #forgetUndeclared(Map)} for the extensions found in the installation, active or not; an
     * extension whose manifest cannot be read keeps its grants. The permissions of the apps of an
     * extension (MK-030) count as declared.
     */
    public int forgetUndeclared(List<InstalledExtension> found) {
        Map<String, Optional<Set<String>>> installed = new HashMap<>();
        for (InstalledExtension extension : found) {
            Optional<Set<String>> declared = extension
                    .manifest()
                    .map(manifest -> AppPermissions.withApps(manifest).stream()
                            .map(PermissionEntry::name)
                            .collect(Collectors.toSet()));
            installed.merge(
                    extension.key(),
                    declared,
                    (first, second) -> first.isEmpty() || second.isEmpty()
                            ? Optional.empty()
                            : Optional.of(union(first.get(), second.get())));
        }
        return forgetUndeclared(installed);
    }

    private static Set<String> union(Set<String> first, Set<String> second) {
        Set<String> all = new HashSet<>(first);
        all.addAll(second);
        return all;
    }

    // Helpers.

    private record Checked(
            String name, String description, Optional<String> defaultForRole, List<PermissionId> permissions) {}

    private Checked check(UUID organization, ProfileRequest request, UUID self) {
        if (request == null) {
            throw new InvalidInputException(List.of("name is required"));
        }
        List<String> problems = new ArrayList<>();
        String name = request.name() == null ? "" : request.name().strip();
        String description =
                request.description() == null ? "" : request.description().strip();
        if (name.isEmpty()) {
            problems.add("name is required");
        } else if (name.length() > MAX_NAME) {
            problems.add("name is longer than " + MAX_NAME + " characters");
        }
        if (description.length() > MAX_DESCRIPTION) {
            problems.add("description is longer than " + MAX_DESCRIPTION + " characters");
        }
        Optional<String> role = Optional.ofNullable(request.defaultForRole()).filter(value -> !value.isBlank());
        if (role.isPresent() && !PROFILE_ROLES.contains(role.get())) {
            problems.add("defaultForRole can only be " + String.join(", ", PROFILE_ROLES));
        }
        Set<PermissionId> permissions = new LinkedHashSet<>();
        for (String value : request.permissions() == null ? List.<String>of() : request.permissions()) {
            try {
                PermissionId id = PermissionId.parse(value == null ? "" : value);
                if (!catalog.isDeclared(id)) {
                    problems.add("permissions " + value + " is not declared by an active extension");
                } else {
                    permissions.add(id);
                }
            } catch (IllegalArgumentException e) {
                problems.add("permissions " + value + " is not a permission: " + e.getMessage());
            }
        }
        if (!problems.isEmpty()) {
            throw new InvalidInputException(problems);
        }
        if (repository.countNamed(organization, name, self == null ? new UUID(0, 0) : self) > 0) {
            throw new ConflictException("A profile named '" + name + "' already exists.");
        }
        return new Checked(name, description, role, List.copyOf(permissions));
    }

    /** The previous default profile of the role is the default no longer. */
    private void unsetDefault(UUID organization, String role, UUID self, Instant now) {
        repository
                .defaultProfile(organization, role)
                .filter(previous -> !previous.getId().equals(self))
                .ifPresent(previous -> {
                    previous.notDefault(now);
                    repository.update(previous);
                });
    }

    private PermissionProfile requireProfile(UUID organization, UUID id) {
        return repository
                .findProfile(id)
                .filter(profile -> profile.getOrganizationId().equals(organization))
                .orElseThrow(() -> new ResourceNotFoundException("No profile " + id + " in the organization."));
    }

    private Team requireTeam(UUID organization, UUID id) {
        return teams.findById(id)
                .filter(team -> team.getOrganizationId().equals(organization))
                .filter(team -> Team.TEAM.equals(team.getKind()))
                .orElseThrow(() -> new ResourceNotFoundException("No team " + id + " in the organization."));
    }

    private OrganizationMember requireMember(UUID organization, String email) {
        String username = normalize(email);
        return accounts.findByUsername(username)
                .map(UserAccount::getId)
                .flatMap(account -> members.findByAccountIdAndOrganizationId(account, organization))
                .orElseThrow(() -> new ResourceNotFoundException("No member '" + username + "' in the organization."));
    }

    /** A qualified identifier that an active extension declares. */
    private PermissionId declared(String field, String value) {
        PermissionId id = parse(field, value);
        if (!catalog.isDeclared(id)) {
            throw new InvalidInputException(List.of(field + " " + value + " is not declared by an active extension"));
        }
        return id;
    }

    private static PermissionId parse(String field, String value) {
        try {
            return PermissionId.parse(value == null ? "" : value);
        } catch (IllegalArgumentException e) {
            throw new InvalidInputException(List.of(field + " " + value + " is not a permission: " + e.getMessage()));
        }
    }

    private List<String> permissionsOf(UUID organization, UUID profile) {
        return ids(repository.ofProfile(organization, profile).stream()
                .map(PermissionGrant::permissionId)
                .toList());
    }

    private static List<String> ids(Collection<PermissionId> permissions) {
        return permissions.stream()
                .map(PermissionId::toString)
                .sorted()
                .distinct()
                .toList();
    }

    private static ProfileView view(PermissionProfile profile, List<String> permissions) {
        return new ProfileView(
                profile.getId(),
                profile.getName(),
                profile.getDescription(),
                profile.getDefaultForRole().orElse(null),
                permissions.stream().sorted().toList());
    }

    private List<EffectiveView> views(Effective effective) {
        List<EffectiveView> views = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        effective.sources().forEach((permission, sources) -> {
            if (!seen.add(permission.toString())) {
                return;
            }
            String title = catalog.find(permission)
                    .map(PermissionCatalog.Declared::title)
                    .orElse(permission.name());
            boolean held = effective.holds(permission);
            views.add(new EffectiveView(
                    permission.toString(),
                    permission.extension(),
                    permission.name(),
                    title,
                    held,
                    held ? null : "apps-off",
                    List.copyOf(sources)));
        });
        return views;
    }

    private void record(UUID organization, String action, String subject, Map<String, ?> detail) {
        audit.append(
                identity.getPrincipal().getName(),
                Optional.of(organization),
                action,
                subject,
                AuditEvent.Outcome.SUCCEEDED,
                detail);
    }

    private static String normalize(String email) {
        return email == null ? "" : email.trim().toLowerCase(Locale.ROOT);
    }
}
