// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.apps;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.util.List;
import java.util.UUID;

/** Jakarta Data repository of the apps of organizations. */
@Repository
public interface OrganizationApps {

    @Find
    List<OrganizationApp> findByOrganizationId(UUID organizationId);

    @Insert
    void insert(OrganizationApp app);

    @Query("delete from OrganizationApp a where a.organizationId = :organizationId")
    int deleteByOrganizationId(UUID organizationId);
}
