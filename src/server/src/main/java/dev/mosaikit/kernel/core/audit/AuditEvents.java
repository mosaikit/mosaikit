// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import jakarta.data.Limit;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import java.util.List;
import java.util.UUID;

/** Jakarta Data repository of the audit log. It has no update and no delete, on purpose. */
@Repository
public interface AuditEvents {

    @Insert
    void insert(AuditEvent event);

    @Query("from AuditEvent e order by e.occurredAt desc, e.id")
    List<AuditEvent> latest(Limit limit);

    @Query("from AuditEvent e where e.organizationId = :organizationId order by e.occurredAt desc, e.id")
    List<AuditEvent> latestOf(UUID organizationId, Limit limit);
}
