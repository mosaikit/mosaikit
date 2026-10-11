// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import jakarta.data.repository.Delete;
import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.util.List;
import java.util.UUID;

/** Jakarta Data repository of the email domains of organizations. */
@Repository
public interface EmailDomains {

    @Find
    List<EmailDomain> findByOrganizationId(UUID organizationId);

    @Query("from EmailDomain d order by d.domain")
    List<EmailDomain> findAllOrdered();

    @Query("select count(d) from EmailDomain d where d.domain = :domain and d.organizationId <> :organizationId")
    long countOwnedByOthers(String domain, UUID organizationId);

    @Insert
    void insert(EmailDomain domain);

    @Delete
    void deleteByOrganizationId(UUID organizationId);
}
