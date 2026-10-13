// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of organizations. The implementation is generated at build time. */
@Repository
public interface Organizations {

    @Find
    Optional<Organization> findById(UUID id);

    @Find
    Optional<Organization> findBySlug(String slug);

    @Find
    Optional<Organization> findByIdentityRealm(String identityRealm);

    @Query("select count(o) from Organization o where o.slug = :slug")
    long countBySlug(String slug);

    @Query("from Organization o order by o.name")
    List<Organization> findAllOrderedByName();

    @Insert
    void insert(Organization organization);

    @Update
    void update(Organization organization);
}
