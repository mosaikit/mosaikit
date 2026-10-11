// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.activity;

import java.time.Instant;
import java.util.UUID;

/** A notification of the activity feed, as the shell shows it (MK-038). */
public record NotificationView(
        UUID id,
        String pluginId,
        String kind,
        String title,
        String body,
        String link,
        Instant createdAt,
        boolean read) {

    static NotificationView of(Notification notification) {
        return new NotificationView(
                notification.getId(),
                notification.getPluginId(),
                notification.getKind(),
                notification.getTitle(),
                notification.getBody(),
                notification.getLink(),
                notification.getCreatedAt(),
                notification.getReadAt() != null);
    }
}
