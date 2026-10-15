// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.search;

import dev.mosaikit.kernel.api.teams.People;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.teams.KernelPeople;
import dev.mosaikit.kernel.core.teams.TeamService;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * The providers of the kernel (MK-040): the people and the teams of the organization of the request,
 * found with PostgreSQL full-text search (ADR-0030). A person sees the people and the teams they would
 * see elsewhere in the shell: a member every person of the organization and the public teams, the
 * private ones they are in (all of them for an administrator); a guest only their teams and the
 * people of those teams; a request admitted by a shared link nobody.
 */
@ApplicationScoped
@Transactional
public class KernelSearch {

    /** The most matches read before the teams or the people that the person may see are kept. */
    static final int MAX_MATCHES = 1000;

    private static final String PEOPLE = """
            select a.id, a.display_name, a.username from {h-schema}user_account a
            join {h-schema}organization_member m on m.account_id = a.id
            where m.organization_id = :organization
              and to_tsvector('simple', a.display_name || ' ' || translate(a.username, '@.-_+', '     '))
                  @@ to_tsquery('simple', :query)
            order by lower(a.display_name), a.username
            limit :limit offset :offset""";

    private static final String TEAMS = """
            select t.id from {h-schema}team t
            where t.organization_id = :organization and t.kind = 'team' and t.parent_id is null
              and to_tsvector('simple', t.name || ' ' || t.description) @@ to_tsquery('simple', :query)
            order by lower(t.name), t.id
            limit :limit""";

    private final EntityManager entityManager;
    private final RequestOrganization organization;
    private final TeamService teams;
    private final KernelPeople people;

    public KernelSearch(
            EntityManager entityManager, RequestOrganization organization, TeamService teams, KernelPeople people) {
        this.entityManager = entityManager;
        this.organization = organization;
        this.teams = teams;
        this.people = people;
    }

    /** The people whose name or email address match. */
    public SearchHit.Page people(SearchText text, int offset, int limit) {
        UUID org = organization.require();
        if (organization.admittedByLink()) {
            return new SearchHit.Page(List.of(), false);
        }
        // A guest sees few people, those of their teams: the matches are read first, then kept.
        Set<UUID> visible = organization.guest()
                ? people.list().stream().map(People.Person::account).collect(Collectors.toSet())
                : null;
        List<Object[]> rows = rows(entityManager
                .createNativeQuery(PEOPLE)
                .setParameter("organization", org)
                .setParameter("query", text.tsquery())
                .setParameter("limit", visible == null ? limit + 1 : MAX_MATCHES)
                .setParameter("offset", visible == null ? offset : 0)
                .getResultList());
        List<SearchHit> hits = new ArrayList<>();
        for (Object[] row : rows) {
            if (visible == null || visible.contains((UUID) row[0])) {
                hits.add(new SearchHit((String) row[1], (String) row[2], null, null));
            }
        }
        return visible == null ? SearchHit.Page.of(hits, limit) : page(hits, offset, limit);
    }

    /** The teams whose name or description match, among those the person sees. */
    public SearchHit.Page teams(SearchText text, int offset, int limit) {
        UUID org = organization.require();
        if (organization.admittedByLink()) {
            return new SearchHit.Page(List.of(), false);
        }
        Map<UUID, TeamService.TeamView> visible =
                teams.list().stream().collect(Collectors.toMap(TeamService.TeamView::id, Function.identity()));
        List<?> ids = entityManager
                .createNativeQuery(TEAMS, UUID.class)
                .setParameter("organization", org)
                .setParameter("query", text.tsquery())
                .setParameter("limit", MAX_MATCHES)
                .getResultList();
        List<SearchHit> hits = new ArrayList<>();
        for (Object id : ids) {
            TeamService.TeamView team = visible.get((UUID) id);
            if (team != null) {
                String description =
                        team.description() == null || team.description().isBlank() ? null : team.description();
                hits.add(new SearchHit(team.name(), description, null, null));
            }
        }
        return page(hits, offset, limit);
    }

    private static SearchHit.Page page(List<SearchHit> hits, int offset, int limit) {
        if (offset >= hits.size()) {
            return new SearchHit.Page(List.of(), false);
        }
        return SearchHit.Page.of(hits.subList(offset, Math.min(hits.size(), offset + limit + 1)), limit);
    }

    @SuppressWarnings("unchecked")
    private static List<Object[]> rows(List<?> rows) {
        return (List<Object[]>) rows;
    }
}
