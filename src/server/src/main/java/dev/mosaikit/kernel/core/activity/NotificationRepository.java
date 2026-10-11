// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.activity;

import jakarta.data.Limit;
import jakarta.data.repository.Find;
import jakarta.data.repository.Insert;
import jakarta.data.repository.Query;
import jakarta.data.repository.Repository;
import jakarta.data.repository.Update;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/** Jakarta Data repository of the notifications. */
@Repository
public interface NotificationRepository {

    @Find
    Optional<Notification> findById(UUID id);

    @Query("""
            from Notification n
            where n.accountId = :accountId and n.organizationId = :organizationId
            order by n.createdAt desc, n.id""")
    List<Notification> feed(UUID accountId, UUID organizationId, Limit limit);

    @Query("""
            select count(n) from Notification n
            where n.accountId = :accountId and n.organizationId = :organizationId and n.readAt is null""")
    long unread(UUID accountId, UUID organizationId);

    @Insert
    void insert(Notification notification);

    @Update
    void update(Notification notification);
}
