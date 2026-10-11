// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.sample.estimates;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of estimates and of the activities they are about. */
@Repository
public interface Estimates {

    @Find
    Optional<Estimate> findByActivityId(UUID activityId);

    @Query("from Estimate e")
    List<Estimate> all();

    @Find
    Optional<ActivitySummary> findActivity(UUID id);

    @Query("from ActivitySummary a order by a.title, a.id")
    List<ActivitySummary> activities();

    @Insert
    void insert(Estimate estimate);

    @Update
    void update(Estimate estimate);
}
