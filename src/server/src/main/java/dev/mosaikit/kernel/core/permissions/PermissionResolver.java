// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.permissions;

import com.fasterxml.jackson.annotation.JsonInclude;
import dev.mosaikit.kernel.api.permission.PermissionId;
import dev.mosaikit.kernel.core.apps.AppSettings;
import dev.mosaikit.kernel.core.security.Roles;
import dev.mosaikit.kernel.core.teams.Team;
import dev.mosaikit.kernel.core.teams.TeamRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;

/**
 * Who holds which permission in an organization, and why (MK-056, ADR-0038). The rules:
 *
 * <ul>
 *   <li>deny by default: only a grant gives a permission;
 *   <li>grants only add: the profile of a member (theirs, or the default of their role), the teams of
 *       the person and their personal exceptions;
 *   <li>the administrators of the organization hold every permission of every active extension;
 *   <li>guests hold only what their teams and their exceptions grant, never a profile;
 *   <li>a permission that no active extension declares is never held;
 *   <li>the permissions of an extension whose apps are all off for the organization (MK-030) are
 *       withheld: they keep their sources, but nobody holds them.
 * </ul>
 */
@ApplicationScoped
@Transactional
public class PermissionResolver {

    /** The role whose members get the default profile when they have none of their own. */
    public static final String MEMBER_ROLE = Roles.ORGANIZATION_USER;

    /** How a person stands in the organization, for permissions. */
    public enum Standing {
        /** An administrator of the organization: every permission. */
        ADMINISTRATOR,
        /** A member: profile, teams and exceptions. */
        MEMBER,
        /** A guest: teams and exceptions only. */
        GUEST,
        /** Nobody of the organization, such as a platform administrator who is not a member: none. */
        NONE;

        /** The standing that the roles of a person in an organization give. */
        public static Standing of(Set<String> roles) {
            if (roles.contains(Roles.ORGANIZATION_ADMIN)) {
                return ADMINISTRATOR;
            }
            if (roles.contains(Roles.ORGANIZATION_USER)) {
                return MEMBER;
            }
            if (roles.contains(Roles.ORGANIZATION_GUEST)) {
                return GUEST;
            }
            return NONE;
        }
    }

    /**
     * A person, real or proposed, whose permissions are resolved.
     *
     * @param standing how they stand in the organization
     * @param account their account, or {@code null} for a person not yet a member (a preview)
     * @param profile the profile to use instead of the one assigned to the account
     * @param teams the teams to use instead of those of the account
     */
    public record Holder(Standing standing, UUID account, Optional<UUID> profile, Optional<List<UUID>> teams) {

        public Holder {
            Objects.requireNonNull(standing, "standing");
            profile = Objects.requireNonNullElse(profile, Optional.empty());
            teams = Objects.requireNonNullElse(teams, Optional.empty());
        }

        /** A person of the organization, with what is stored for them. */
        public static Holder of(Standing standing, UUID account) {
            return new Holder(standing, account, Optional.empty(), Optional.empty());
        }
    }

    /**
     * Where a permission comes from.
     *
     * @param kind {@code administrator}, {@code profile}, {@code team} or {@code exception}
     * @param id the profile or the team, when there is one
     * @param name the name of the profile or of the team
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Source(String kind, UUID id, String name) {

        static final Source ADMINISTRATOR = new Source("administrator", null, null);
        static final Source EXCEPTION = new Source("exception", null, null);

        static Source profile(PermissionProfile profile) {
            return new Source("profile", profile.getId(), profile.getName());
        }

        static Source team(UUID id, String name) {
            return new Source("team", id, name);
        }
    }

    /**
     * The permissions a person has, with their sources.
     *
     * @param sources every declared permission that something grants, with what grants it
     * @param off the extensions whose apps are all off for the organization: their permissions are
     *     withheld
     * @param profile the profile that applies to the person, if any
     */
    public record Effective(
            Map<PermissionId, List<Source>> sources, Set<String> off, Optional<PermissionProfile> profile) {

        /** Whether the person holds the permission. */
        public boolean holds(PermissionId permission) {
            return sources.containsKey(permission) && !off.contains(permission.extension());
        }

        /** The permissions the person holds, by qualified identifier. */
        public List<PermissionId> held() {
            return sources.keySet().stream().filter(this::holds).toList();
        }
    }

    private final PermissionRepository permissions;
    private final TeamRepository teams;
    private final PermissionCatalog catalog;
    private final AppSettings apps;

    public PermissionResolver(
            PermissionRepository permissions, TeamRepository teams, PermissionCatalog catalog, AppSettings apps) {
        this.permissions = permissions;
        this.teams = teams;
        this.catalog = catalog;
        this.apps = apps;
    }

    /** Whether the person holds one permission, which an active extension declares. */
    public boolean holds(UUID organization, Holder holder, PermissionId permission) {
        if (holder.standing() == Standing.NONE || !catalog.isDeclared(permission)) {
            return false;
        }
        if (apps.isOff(organization, permission.extension())) {
            return false;
        }
        if (holder.standing() == Standing.ADMINISTRATOR) {
            return true;
        }
        return grants(organization, holder, new HashMap<>(), new ArrayList<>()).containsKey(permission);
    }

    /** Every permission of the person, with where each comes from. */
    public Effective effective(UUID organization, Holder holder) {
        Map<PermissionId, List<Source>> sources = new TreeMap<>(Comparator.comparing(PermissionId::toString));
        List<PermissionProfile> profile = new ArrayList<>(1);
        if (holder.standing() == Standing.ADMINISTRATOR) {
            catalog.all()
                    .forEach(declared -> sources.computeIfAbsent(declared.permissionId(), _ -> new ArrayList<>())
                            .add(Source.ADMINISTRATOR));
        }
        if (holder.standing() != Standing.NONE) {
            grants(organization, holder, new HashMap<>(), profile)
                    .forEach((permission, from) -> sources.computeIfAbsent(permission, _ -> new ArrayList<>())
                            .addAll(from));
        }
        Set<String> off = new HashSet<>();
        sources.keySet().stream()
                .map(PermissionId::extension)
                .distinct()
                .filter(extension -> apps.isOff(organization, extension))
                .forEach(off::add);
        return new Effective(
                Collections.unmodifiableMap(sources),
                Set.copyOf(off),
                profile.stream().findFirst());
    }

    /** The profile that applies to a member: theirs, or the default of their role. */
    public Optional<PermissionProfile> profileOf(UUID organization, UUID account) {
        return permissions
                .memberProfile(organization, account)
                .flatMap(assigned -> permissions.findProfile(assigned.getProfileId()))
                .or(() -> permissions.defaultProfile(organization, MEMBER_ROLE));
    }

    /**
     * The declared permissions that the profile, the teams and the exceptions of a person grant, with
     * their sources; the profile used goes into {@code profileUsed}.
     */
    private Map<PermissionId, List<Source>> grants(
            UUID organization, Holder holder, Map<UUID, String> teamNames, List<PermissionProfile> profileUsed) {
        Map<PermissionId, List<Source>> found = new LinkedHashMap<>();
        if (holder.standing() == Standing.MEMBER) {
            Optional<PermissionProfile> profile = holder.profile().isPresent()
                    ? holder.profile().flatMap(permissions::findProfile)
                    : holder.account() == null
                            ? permissions.defaultProfile(organization, MEMBER_ROLE)
                            : profileOf(organization, holder.account());
            profile.filter(p -> p.getOrganizationId().equals(organization)).ifPresent(p -> {
                profileUsed.add(p);
                permissions
                        .ofProfile(organization, p.getId())
                        .forEach(grant -> add(found, grant.permissionId(), Source.profile(p)));
            });
        }
        List<PermissionGrant> ofTeams = holder.teams().isPresent()
                ? (holder.teams().get().isEmpty()
                        ? List.of()
                        : permissions.ofTeams(organization, holder.teams().get()))
                : holder.account() == null ? List.of() : permissions.ofTeamsOf(organization, holder.account());
        for (PermissionGrant grant : ofTeams) {
            String name = teamNames.computeIfAbsent(
                    grant.getTeamId(),
                    id -> teams.findById(id).map(Team::getName).orElse(""));
            add(found, grant.permissionId(), Source.team(grant.getTeamId(), name));
        }
        if (holder.account() != null) {
            permissions
                    .ofMember(organization, holder.account())
                    .forEach(grant -> add(found, grant.permissionId(), Source.EXCEPTION));
        }
        return found;
    }

    private void add(Map<PermissionId, List<Source>> found, PermissionId permission, Source source) {
        if (catalog.isDeclared(permission)) {
            found.computeIfAbsent(permission, _ -> new ArrayList<>()).add(source);
        }
    }
}
