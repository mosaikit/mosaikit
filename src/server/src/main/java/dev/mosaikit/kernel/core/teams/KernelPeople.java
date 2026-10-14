// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.teams;

import dev.mosaikit.kernel.api.teams.People;
import dev.mosaikit.kernel.api.teams.Teams;
import dev.mosaikit.kernel.core.account.UserAccount;
import dev.mosaikit.kernel.core.account.UserAccounts;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.organization.OrganizationMember;
import dev.mosaikit.kernel.core.organization.OrganizationMembers;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The kernel's {@link People} bean (MK-032, MK-123): the people and the teams of the organization of
 * the request, read-only, for the extensions that name them outside the kernel. It answers for the
 * organization, private teams included and chats never; a guest of the organization gets only their
 * teams and the people of those teams, and a request that a shared link admitted gets nobody.
 */
@ApplicationScoped
@Transactional
public class KernelPeople implements People {

    static final String ADMINISTRATOR = "administrator";
    static final String MEMBER = "member";
    static final String GUEST = "guest";

    private final TeamRepository teams;
    private final OrganizationMembers members;
    private final UserAccounts accounts;
    private final RequestOrganization organization;
    private final SecurityIdentity identity;

    public KernelPeople(
            TeamRepository teams,
            OrganizationMembers members,
            UserAccounts accounts,
            RequestOrganization organization,
            SecurityIdentity identity) {
        this.teams = teams;
        this.members = members;
        this.accounts = accounts;
        this.organization = organization;
        this.identity = identity;
    }

    /**
     * What the request may read of the organization.
     *
     * @param teams the teams it reads, or {@code null} for all of them
     * @param people the people it reads, or {@code null} for all of them
     */
    private record Scope(UUID organization, Set<UUID> teams, Set<UUID> people) {

        boolean team(UUID team) {
            return teams == null || teams.contains(team);
        }

        boolean person(UUID account) {
            return people == null || people.contains(account);
        }
    }

    private Scope scope() {
        UUID org = organization.require();
        if (organization.admittedByLink()) {
            return new Scope(org, Set.of(), Set.of());
        }
        if (!organization.guest()) {
            return new Scope(org, null, null);
        }
        Optional<UUID> me = RequestOrganization.account(identity);
        if (me.isEmpty()) {
            return new Scope(org, Set.of(), Set.of());
        }
        Set<UUID> theirs = teams.membershipsIn(me.get(), org).stream()
                .map(TeamMember::getTeamId)
                .collect(Collectors.toCollection(HashSet::new));
        Set<UUID> ofTeams = new HashSet<>();
        Set<UUID> visible = new HashSet<>();
        for (UUID id : theirs) {
            teams.findById(id).filter(team -> !team.isChat()).ifPresent(team -> {
                visible.add(team.getId());
                teams.members(team.getId()).forEach(member -> ofTeams.add(member.getAccountId()));
            });
        }
        ofTeams.add(me.get());
        return new Scope(org, Set.copyOf(visible), Set.copyOf(ofTeams));
    }

    @Override
    public Optional<Person> find(UUID account) {
        Objects.requireNonNull(account, "account");
        Scope scope = scope();
        if (!scope.person(account)) {
            return Optional.empty();
        }
        return members.findByAccountIdAndOrganizationId(account, scope.organization())
                .flatMap(member -> accounts.findById(account).flatMap(found -> person(found, member)));
    }

    @Override
    public Optional<Person> findByUsername(String username) {
        Objects.requireNonNull(username, "username");
        return accounts.findByUsername(username.trim().toLowerCase(Locale.ROOT))
                .flatMap(account -> find(account.getId()));
    }

    @Override
    public List<Person> list() {
        Scope scope = scope();
        List<Person> found = new ArrayList<>();
        for (OrganizationMember member : members.findByOrganizationId(scope.organization())) {
            if (scope.person(member.getAccountId())) {
                accounts.findById(member.getAccountId())
                        .flatMap(account -> person(account, member))
                        .ifPresent(found::add);
            }
        }
        found.sort(Comparator.comparing(Person::displayName, String.CASE_INSENSITIVE_ORDER)
                .thenComparing(Person::username));
        return found;
    }

    @Override
    public List<OrganizationTeam> teams() {
        Scope scope = scope();
        return teams.teamsAndGroupsOf(scope.organization()).stream()
                .filter(team -> scope.team(team.getId()))
                .map(KernelPeople::view)
                .toList();
    }

    @Override
    public List<Teams.Member> members(UUID team) {
        Objects.requireNonNull(team, "team");
        Scope scope = scope();
        if (!scope.team(team)) {
            return List.of();
        }
        return teams.findById(team)
                .filter(found -> found.getOrganizationId().equals(scope.organization()) && !found.isChat())
                .map(found -> peopleOf(found.getId()))
                .orElse(List.of());
    }

    @Override
    public List<OrganizationTeam> teamsOf(UUID account) {
        Objects.requireNonNull(account, "account");
        Scope scope = scope();
        if (!scope.person(account)) {
            return List.of();
        }
        Set<UUID> in = teams.membershipsIn(account, scope.organization()).stream()
                .map(TeamMember::getTeamId)
                .collect(Collectors.toSet());
        return teams.teamsAndGroupsOf(scope.organization()).stream()
                .filter(team -> in.contains(team.getId()) && scope.team(team.getId()))
                .map(KernelPeople::view)
                .toList();
    }

    private List<Teams.Member> peopleOf(UUID team) {
        List<Teams.Member> result = new ArrayList<>();
        for (TeamMember member : teams.members(team)) {
            accounts.findById(member.getAccountId())
                    .ifPresent(account -> result.add(new Teams.Member(
                            account.getId(), account.getUsername(), account.getDisplayName(), member.getRole())));
        }
        result.sort(Comparator.comparing((Teams.Member member) -> rank(member.role()))
                .thenComparing(Teams.Member::displayName, String.CASE_INSENSITIVE_ORDER));
        return result;
    }

    private static int rank(String role) {
        return switch (role) {
            case TeamMember.OWNER -> 0;
            case TeamMember.MEMBER -> 1;
            default -> 2;
        };
    }

    private static Optional<Person> person(UserAccount account, OrganizationMember member) {
        Set<String> roles = member.getRoles();
        String standing;
        if (roles.contains(Roles.ORGANIZATION_ADMIN)) {
            standing = ADMINISTRATOR;
        } else if (roles.contains(Roles.ORGANIZATION_USER)) {
            standing = MEMBER;
        } else if (roles.contains(Roles.ORGANIZATION_GUEST)) {
            standing = GUEST;
        } else {
            return Optional.empty();
        }
        return Optional.of(new Person(
                account.getId(), account.getUsername(), account.getDisplayName(), !account.isSuspended(), standing));
    }

    private static OrganizationTeam view(Team team) {
        return new OrganizationTeam(
                team.getId(), team.getName(), team.getDescription(), team.getVisibility(), team.getParentId());
    }
}
