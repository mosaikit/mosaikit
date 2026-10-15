// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.branding;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of the branding of organizations (MK-074). */
@Repository
public interface OrganizationBrandings {

    @Find
    Optional<OrganizationBranding> findById(UUID organizationId);

    @Insert
    void insert(OrganizationBranding branding);

    @Update
    void update(OrganizationBranding branding);
}
