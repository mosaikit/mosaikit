// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.permissions;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.permission.PermissionHolders;
import dev.mosaikit.kernel.api.permission.PermissionId;
import dev.mosaikit.kernel.core.apps.AppSettings;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.organization.OrganizationMember;
import dev.mosaikit.kernel.core.organization.OrganizationMembers;
import dev.mosaikit.kernel.core.permissions.PermissionResolver.Standing;
import dev.mosaikit.kernel.core.teams.Team;
import dev.mosaikit.kernel.core.teams.TeamMember;
import dev.mosaikit.kernel.core.teams.TeamRepository;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The kernel's {@link PermissionHolders} bean (MK-056): who holds a permission of the calling
 * extension in the organization of the request, by the rules of {@link PermissionResolver}, read in
 * a few queries for the whole organization instead of one person at a time.
 */
@ApplicationScoped
@Transactional
public class KernelPermissionHolders implements PermissionHolders {

    private final PermissionRepository permissions;
    private final PermissionCatalog catalog;
    private final AppSettings apps;
    private final OrganizationMembers members;
    private final TeamRepository teams;
    private final RequestOrganization organization;
    private final SecurityIdentity identity;

    public KernelPermissionHolders(
            PermissionRepository permissions,
            PermissionCatalog catalog,
            AppSettings apps,
            OrganizationMembers members,
            TeamRepository teams,
            RequestOrganization organization,
            SecurityIdentity identity) {
        this.permissions = permissions;
        this.catalog = catalog;
        this.apps = apps;
        this.members = members;
        this.teams = teams;
        this.organization = organization;
        this.identity = identity;
    }

    @Override
    public Holders of(String extension, String permission) {
        Objects.requireNonNull(permission, "permission");
        ExtensionManifest manifest = catalog.requireActive(extension);
        UUID org = organization.require();
        PermissionId id = new PermissionId(extension, permission);
        Holders nobody = new Holders(id, Set.of(), Set.of());
        if (!PermissionCatalog.declares(manifest, permission)
                || apps.isOff(org, extension)
                || organization.admittedByLink()) {
            return nobody;
        }
        Map<UUID, Standing> standing = new HashMap<>();
        for (OrganizationMember member : members.findByOrganizationId(org)) {
            Standing of = Standing.of(member.getRoles());
            if (of != Standing.NONE) {
                standing.put(member.getAccountId(), of);
            }
        }
        List<PermissionGrant> grants = permissions.ofPermission(org, extension, permission);
        Set<UUID> profiles = new HashSet<>();
        Set<UUID> granted = new HashSet<>();
        Set<UUID> people = new HashSet<>();
        for (PermissionGrant grant : grants) {
            if (grant.getProfileId() != null) {
                profiles.add(grant.getProfileId());
            } else if (grant.getTeamId() != null) {
                granted.add(grant.getTeamId());
            } else if (grant.getAccountId() != null && standing.containsKey(grant.getAccountId())) {
                // A personal exception, to a member or a guest.
                people.add(grant.getAccountId());
            }
        }
        Set<UUID> ofTeams = new HashSet<>();
        for (UUID team : granted) {
            Optional<Team> found =
                    teams.findById(team).filter(t -> t.getOrganizationId().equals(org));
            if (found.isEmpty()) {
                continue;
            }
            ofTeams.add(team);
            teams.members(team).stream()
                    .map(TeamMember::getAccountId)
                    .filter(standing::containsKey)
                    .forEach(people::add);
        }
        Optional<UUID> byDefault =
                permissions.defaultProfile(org, PermissionResolver.MEMBER_ROLE).map(PermissionProfile::getId);
        Map<UUID, UUID> assigned = permissions.memberProfiles(org).stream()
                .collect(Collectors.toMap(MemberProfile::getAccountId, MemberProfile::getProfileId));
        standing.forEach((account, of) -> {
            if (of == Standing.ADMINISTRATOR) {
                people.add(account);
            } else if (of == Standing.MEMBER) {
                // Guests never get a profile.
                Optional<UUID> profile =
                        Optional.ofNullable(assigned.get(account)).or(() -> byDefault);
                if (profile.filter(profiles::contains).isPresent()) {
                    people.add(account);
                }
            }
        });
        return limited(new Holders(id, people, ofTeams), org);
    }

    /**
     * The holders that a guest of the organization may read: those of their teams and themselves,
     * and their teams; anyone else reads them all.
     */
    private Holders limited(Holders holders, UUID org) {
        if (!organization.guest()) {
            return holders;
        }
        Optional<UUID> me = RequestOrganization.account(identity);
        if (me.isEmpty()) {
            return new Holders(holders.permission(), Set.of(), Set.of());
        }
        Set<UUID> theirTeams = new HashSet<>();
        Set<UUID> theirPeople = new HashSet<>(Set.of(me.get()));
        for (TeamMember membership : teams.membershipsIn(me.get(), org)) {
            if (teams.findById(membership.getTeamId())
                    .filter(team -> !team.isChat())
                    .isPresent()) {
                theirTeams.add(membership.getTeamId());
                teams.members(membership.getTeamId()).forEach(member -> theirPeople.add(member.getAccountId()));
            }
        }
        return new Holders(
                holders.permission(),
                holders.people().stream().filter(theirPeople::contains).collect(Collectors.toSet()),
                holders.teams().stream().filter(theirTeams::contains).collect(Collectors.toSet()));
    }
}
