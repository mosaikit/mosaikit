// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.OrganizationMember;
import dev.mosaikit.kernel.core.organization.OrganizationService;
import dev.mosaikit.kernel.core.security.Roles;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The people of the installation, for the console of the platform administrators (MK-072): every
 * account with its organizations, found by name or address and by whether it is suspended.
 */
@ApplicationScoped
@Transactional
public class PlatformPeople {

    /** The most people one page lists. */
    public static final int MAX_LIMIT = 200;

    /** Which people a page lists, by whether they may sign in. */
    public enum State {
        ALL,
        ACTIVE,
        SUSPENDED;

        /** The state named in a query, {@code all} when it names none. */
        public static State of(String name) {
            if (name == null || name.isBlank()) {
                return ALL;
            }
            return switch (name.strip().toLowerCase(Locale.ROOT)) {
                case "active" -> ACTIVE;
                case "suspended" -> SUSPENDED;
                default -> ALL;
            };
        }
    }

    /**
     * A person of the installation.
     *
     * @param platformAdmin whether the person administers the platform
     * @param password whether the account has a local password
     * @param organizations the organizations of the person, by name; deleted ones are left out
     */
    public record Person(
            UUID accountId,
            String username,
            String displayName,
            Instant createdAt,
            boolean platformAdmin,
            boolean password,
            boolean suspended,
            Instant suspendedAt,
            String suspendedBy,
            String reason,
            List<Membership> organizations) {}

    /**
     * An organization of a person.
     *
     * @param suspended whether the organization is suspended (MK-072)
     */
    public record Membership(String slug, String name, Set<String> roles, boolean suspended) {}

    /**
     * A page of people.
     *
     * @param total how many people match the search and the state
     * @param people the people of the page, by address
     */
    public record Page(long total, List<Person> people) {}

    /** How many accounts the installation has, and how many of them are suspended. */
    public record Counts(long people, long suspended) {}

    /** The people who match a pattern and a state; the same conditions as {@link #MATCHING}. */
    private static final String COUNT_MATCHING = """
            select count(a) from UserAccount a
            where (:pattern = '' or lower(a.username) like :pattern escape '!'
                   or lower(a.displayName) like :pattern escape '!')
              and (:state = 'ALL' or (:state = 'SUSPENDED' and a.suspendedAt is not null)
                   or (:state = 'ACTIVE' and a.suspendedAt is null))
            """;

    /** The people who match a pattern and a state, by address. */
    private static final String MATCHING = """
            select a from UserAccount a
            where (:pattern = '' or lower(a.username) like :pattern escape '!'
                   or lower(a.displayName) like :pattern escape '!')
              and (:state = 'ALL' or (:state = 'SUSPENDED' and a.suspendedAt is not null)
                   or (:state = 'ACTIVE' and a.suspendedAt is null))
            order by a.username
            """;

    private final EntityManager entityManager;
    private final OrganizationService organizations;

    public PlatformPeople(EntityManager entityManager, OrganizationService organizations) {
        this.entityManager = entityManager;
        this.organizations = organizations;
    }

    /**
     * The people whose address or name contains a text, in a state, by address.
     *
     * @param search the text, or empty for everybody
     * @param offset how many to skip
     * @param limit how many to list, at most {@value #MAX_LIMIT}
     */
    public Page list(String search, State state, int offset, int limit) {
        String pattern = pattern(search);
        long total = entityManager
                .createQuery(COUNT_MATCHING, Long.class)
                .setParameter("pattern", pattern)
                .setParameter("state", state.name())
                .getSingleResult();
        List<UserAccount> found = entityManager
                .createQuery(MATCHING, UserAccount.class)
                .setParameter("pattern", pattern)
                .setParameter("state", state.name())
                .setFirstResult(Math.max(0, offset))
                .setMaxResults(Math.clamp(limit, 1, MAX_LIMIT))
                .getResultList();
        return new Page(total, people(found));
    }

    /** How many accounts there are, and how many are suspended. */
    public Counts counts() {
        long people = entityManager
                .createQuery("select count(a) from UserAccount a", Long.class)
                .getSingleResult();
        long suspended = entityManager
                .createQuery("select count(a) from UserAccount a where a.suspendedAt is not null", Long.class)
                .getSingleResult();
        return new Counts(people, suspended);
    }

    private List<Person> people(List<UserAccount> accounts) {
        if (accounts.isEmpty()) {
            return List.of();
        }
        Map<UUID, Organization> byId =
                organizations.all().stream().collect(Collectors.toMap(Organization::getId, Function.identity()));
        Map<UUID, List<OrganizationMember>> memberships = entityManager
                .createQuery("from OrganizationMember m where m.accountId in :ids", OrganizationMember.class)
                .setParameter("ids", accounts.stream().map(UserAccount::getId).toList())
                .getResultList()
                .stream()
                .collect(Collectors.groupingBy(OrganizationMember::getAccountId));
        return accounts.stream()
                .map(account -> new Person(
                        account.getId(),
                        account.getUsername(),
                        account.getDisplayName(),
                        account.getCreatedAt(),
                        account.getRoles().contains(Roles.PLATFORM_ADMIN),
                        account.getPasswordHash().isPresent(),
                        account.isSuspended(),
                        account.getSuspendedAt().orElse(null),
                        account.getSuspendedBy().orElse(null),
                        account.getSuspensionReason().orElse(null),
                        memberships.getOrDefault(account.getId(), List.of()).stream()
                                .flatMap(member -> Optional.ofNullable(byId.get(member.getOrganizationId()))
                                        .map(organization -> new Membership(
                                                organization.getSlug(),
                                                organization.getName(),
                                                member.getRoles(),
                                                organization.isSuspended()))
                                        .stream())
                                .sorted(Comparator.comparing(Membership::name))
                                .toList()))
                .toList();
    }

    /** A pattern of {@code like} that finds the text anywhere, with its wildcards escaped by {@code !}. */
    static String pattern(String search) {
        if (search == null || search.isBlank()) {
            return "";
        }
        String escaped = search.strip()
                .toLowerCase(Locale.ROOT)
                .replace("!", "!!")
                .replace("%", "!%")
                .replace("_", "!_");
        return "%" + escaped + "%";
    }
}
