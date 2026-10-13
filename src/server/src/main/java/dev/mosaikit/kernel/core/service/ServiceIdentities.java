// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.service;

import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of service identities (MK-124). */
@Repository
public interface ServiceIdentities {

    @Find
    Optional<ServiceIdentity> findById(UUID id);

    @Find
    Optional<ServiceIdentity> findByName(String name);

    @Insert
    void insert(ServiceIdentity identity);

    @Query("select s from ServiceIdentity s order by s.name")
    List<ServiceIdentity> all();

    @Query("update ServiceIdentity s set s.description = :description, s.apis = :apis,"
            + " s.endpoints = :endpoints, s.organizations = :organizations where s.id = :id")
    int grant(UUID id, String description, String apis, String endpoints, String organizations);
}
