// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.files;

import jakarta.data.Limit;
import jakarta.data.repository.Delete;
import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Jakarta Data repository of the files of extensions. Row-level security already limits the rows to
 * those the request may read; the queries name the organization and the teams too, as every query of
 * the kernel does.
 */
@Repository
public interface StoredFiles {

    @Find
    Optional<StoredFile> findById(UUID id);

    /** The files of the organization, not of a team, newest first. */
    @Query("""
            from StoredFile f
            where f.organizationId = :organizationId and f.extensionId = :extensionId and f.teamId is null
            order by f.createdAt desc, f.id""")
    List<StoredFile> listOfOrganization(UUID organizationId, String extensionId, Limit limit);

    /** The files of a team, newest first. */
    @Query("""
            from StoredFile f
            where f.organizationId = :organizationId and f.extensionId = :extensionId and f.teamId = :teamId
            order by f.createdAt desc, f.id""")
    List<StoredFile> listOfTeam(UUID organizationId, String extensionId, UUID teamId, Limit limit);

    /** The files of the organization and of the teams of a person, newest first. */
    @Query("""
            from StoredFile f
            where f.organizationId = :organizationId and f.extensionId = :extensionId
              and ((f.teamId is null and :guest = false)
                or f.teamId in (select m.teamId from TeamMember m where m.accountId = :accountId))
            order by f.createdAt desc, f.id""")
    List<StoredFile> listReadable(UUID organizationId, String extensionId, boolean guest, UUID accountId, Limit limit);

    @Insert
    void insert(StoredFile file);

    @Delete
    void delete(StoredFile file);
}
