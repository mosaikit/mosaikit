// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.permissions;

import jakarta.data.repository.Delete;
import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Jakarta Data repository of profiles, of the profiles of members and of the grants of permissions
 * (MK-056). Row-level security already limits the rows to the organization of the request; the
 * queries name it too, as every query of the kernel does.
 */
@Repository
public interface PermissionRepository {

    // Profiles.

    @Find
    Optional<PermissionProfile> findProfile(UUID id);

    @Query("from PermissionProfile p where p.organizationId = :organizationId order by lower(p.name)")
    List<PermissionProfile> profiles(UUID organizationId);

    @Query("""
            from PermissionProfile p
            where p.organizationId = :organizationId and p.defaultForRole = :role""")
    Optional<PermissionProfile> defaultProfile(UUID organizationId, String role);

    @Query("""
            select count(p) from PermissionProfile p
            where p.organizationId = :organizationId and lower(p.name) = lower(:name) and p.id <> :except""")
    long countNamed(UUID organizationId, String name, UUID except);

    @Insert
    void insert(PermissionProfile profile);

    @Update
    void update(PermissionProfile profile);

    @Delete
    void delete(PermissionProfile profile);

    // Profiles of members.

    @Query("from MemberProfile m where m.organizationId = :organizationId and m.accountId = :accountId")
    Optional<MemberProfile> memberProfile(UUID organizationId, UUID accountId);

    @Insert
    void insert(MemberProfile profile);

    @Update
    void update(MemberProfile profile);

    @Delete
    void delete(MemberProfile profile);

    // Grants.

    @Query("""
            from PermissionGrant g
            where g.organizationId = :organizationId and g.profileId = :profileId
            order by g.extensionId, g.permission""")
    List<PermissionGrant> ofProfile(UUID organizationId, UUID profileId);

    @Query("""
            from PermissionGrant g
            where g.organizationId = :organizationId and g.profileId in :profileIds""")
    List<PermissionGrant> ofProfiles(UUID organizationId, List<UUID> profileIds);

    @Query("""
            from PermissionGrant g
            where g.organizationId = :organizationId and g.teamId in :teamIds
            order by g.extensionId, g.permission""")
    List<PermissionGrant> ofTeams(UUID organizationId, List<UUID> teamIds);

    /** The grants to the teams of a person in the organization, also as a guest. */
    @Query("""
            from PermissionGrant g
            where g.organizationId = :organizationId
              and g.teamId in (select m.teamId from TeamMember m where m.accountId = :accountId)""")
    List<PermissionGrant> ofTeamsOf(UUID organizationId, UUID accountId);

    @Query("""
            from PermissionGrant g
            where g.organizationId = :organizationId and g.accountId = :accountId
            order by g.extensionId, g.permission""")
    List<PermissionGrant> ofMember(UUID organizationId, UUID accountId);

    @Insert
    void insert(PermissionGrant grant);

    @Delete
    void delete(PermissionGrant grant);

    /** Removes, in every organization, the grants of the extensions that are not among those given. */
    @Query("delete from PermissionGrant g where g.extensionId not in :installed")
    int deleteAllExcept(List<String> installed);

    /** Removes, in every organization, the grants of an extension that its manifest does not declare. */
    @Query("delete from PermissionGrant g where g.extensionId = :extensionId and g.permission not in :declared")
    int deleteUndeclared(String extensionId, List<String> declared);

    /** Removes, in every organization, the grants of an extension that declares no permission. */
    @Query("delete from PermissionGrant g where g.extensionId = :extensionId")
    int deleteOf(String extensionId);
}
