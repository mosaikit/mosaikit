// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.live;

import java.util.Collection;
import java.util.UUID;

/**
 * The activity feed of people (MK-038): an extension notifies people of the organization of the request
 * about something that concerns them, such as a mention or an assignment. The kernel keeps the
 * notification in their feed, pushes it to their open pages and leaves out the people who turned
 * that kind off.
 */
public interface Notifications {

    /**
     * A notification.
     *
     * @param kind what it is about, such as {@code mention}, which people can turn off; lowercase
     *     letters, digits and '-'
     * @param title one line, at most 200 characters
     * @param body a few lines, at most 1000 characters, or empty
     * @param link where it opens, a path of the shell such as {@code /app/notes}, or {@code null}
     */
    record Notification(String kind, String title, String body, String link) {}

    /** Notifies people of the organization of the request, by account identifier, as the given extension. */
    void send(String extensionId, Collection<UUID> accounts, Notification notification);
}
