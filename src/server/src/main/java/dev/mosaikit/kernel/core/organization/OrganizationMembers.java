// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import jakarta.data.repository.Delete;
import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of the memberships of accounts in organizations. */
@Repository
public interface OrganizationMembers {

    @Find
    Optional<OrganizationMember> findByAccountIdAndOrganizationId(UUID accountId, UUID organizationId);

    @Find
    Optional<OrganizationMember> findByOrganizationIdAndIdentitySubject(UUID organizationId, String identitySubject);

    @Query("from OrganizationMember m where m.accountId = :accountId order by m.createdAt")
    List<OrganizationMember> findByAccountId(UUID accountId);

    @Query("from OrganizationMember m where m.organizationId = :organizationId order by m.createdAt")
    List<OrganizationMember> findByOrganizationId(UUID organizationId);

    @Insert
    void insert(OrganizationMember member);

    @Update
    void update(OrganizationMember member);

    @Delete
    void delete(OrganizationMember member);
}
