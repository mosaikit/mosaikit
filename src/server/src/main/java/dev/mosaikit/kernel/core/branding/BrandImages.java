// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.branding;

import jakarta.data.repository.Delete;
import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Repository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of the images of the branding of organizations (MK-074). */
@Repository
public interface BrandImages {

    @Find
    List<BrandImage> findByOrganizationId(UUID organizationId);

    @Find
    Optional<BrandImage> findByOrganizationIdAndKind(UUID organizationId, String kind);

    @Insert
    void insert(BrandImage image);

    @Delete
    void delete(BrandImage image);
}
