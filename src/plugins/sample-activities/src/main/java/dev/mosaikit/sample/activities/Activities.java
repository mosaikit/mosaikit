// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.sample.activities;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Jakarta Data repository of activities. The queries do not filter by organization: row-level
 * security (MK-019) shows each request only the activities of its organization.
 */
@Repository
public interface Activities {

    @Query("from Activity a order by a.createdAt, a.id")
    List<Activity> all();

    @Find
    Optional<Activity> findById(UUID id);

    @Insert
    void insert(Activity activity);

    @Update
    void update(Activity activity);
}
