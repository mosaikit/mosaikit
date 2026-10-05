// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.teams;

import jakarta.data.repository.Delete;
import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of the teams and of their people. */
@Repository
public interface TeamRepository {

    @Find
    Optional<Team> findById(UUID id);

    @Query("from Team t where t.organizationId = :organizationId and t.parentId is null order by lower(t.name)")
    List<Team> ofOrganization(UUID organizationId);

    @Query("from Team t where t.parentId = :parentId order by lower(t.name)")
    List<Team> groupsOf(UUID parentId);

    @Query("""
            select count(t) from Team t
            where t.organizationId = :organizationId and t.parentId is null and lower(t.name) = lower(:name)""")
    long countNamed(UUID organizationId, String name);

    @Query("select count(t) from Team t where t.parentId = :parentId and lower(t.name) = lower(:name)")
    long countNamedIn(UUID parentId, String name);

    @Insert
    void insert(Team team);

    @Update
    void update(Team team);

    @Delete
    void delete(Team team);

    @Query("from TeamMember m where m.teamId = :teamId order by m.addedAt")
    List<TeamMember> members(UUID teamId);

    @Query("from TeamMember m where m.teamId = :teamId and m.accountId = :accountId")
    Optional<TeamMember> member(UUID teamId, UUID accountId);

    @Query("""
            select m from TeamMember m, Team t
            where m.teamId = t.id and m.accountId = :accountId and t.organizationId = :organizationId""")
    List<TeamMember> membershipsIn(UUID accountId, UUID organizationId);

    @Insert
    void insert(TeamMember member);

    @Update
    void update(TeamMember member);

    @Delete
    void delete(TeamMember member);
}
