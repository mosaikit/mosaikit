// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.live;

import java.util.Collection;
import java.util.UUID;

/**
 * Events that reach the pages of people in real time (MK-031, ADR-0028), over the WebSocket of the
 * shell. An extension publishes under its own topics, {@code extension.<extension id>.<name>}, for the
 * organization of the request; the event leaves when the transaction of the request commits, and
 * reaches the pages that subscribed to the topic. Send small events, such as the identifier of what
 * changed, and let the pages read the rest through the API: it keeps the rights of each person.
 */
public interface LiveEvents {

    /** At most this many bytes of JSON: an event says what changed, not the whole of it. */
    int MAX_BYTES = 6000;

    /** Sends an event to the people of the organization of the request who subscribed to the topic. */
    void publish(String topic, Object data);

    /** Sends an event only to some people of the organization of the request, by account identifier. */
    void publishTo(String topic, Object data, Collection<UUID> accounts);
}
