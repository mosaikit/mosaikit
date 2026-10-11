// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.sample.notes;

import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.util.List;
import java.util.UUID;

/** Jakarta Data repository of notes; the implementation is generated when the plugin is built. */
@Repository
public interface Notes {

    /** The notes of one organization, oldest first. */
    @Query("from Note n where n.organizationId = :organizationId order by n.createdAt")
    List<Note> findByOrganization(UUID organizationId);

    @Insert
    void insert(Note note);
}
