// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web.csp;

import jakarta.data.repository.Delete;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.util.List;
import java.util.Optional;

/**
 * Jakarta Data repository of the external origins of the content security policy (MK-128). The member
 * role of requests has no right on the table: callers run as the owner first.
 */
@Repository
public interface AllowedOrigins {

    @Query("from AllowedOrigin o order by o.origin")
    List<AllowedOrigin> list();

    @Query("from AllowedOrigin o where o.origin = :origin")
    Optional<AllowedOrigin> find(String origin);

    @Insert
    void insert(AllowedOrigin origin);

    @Delete
    void delete(AllowedOrigin origin);
}
