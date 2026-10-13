// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.events;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.api.events.PlatformEvents;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Raises events of the platform (MK-085): writes the event and one delivery for each subscriber of
 * its type in the transaction of the caller, so that it is delivered if and only if the change that
 * raised it commits, even when the kernel stops right after. Without subscribers of its type nothing
 * is written. The kernel raises its own events here; extensions through {@link ExtensionPlatformEvents}.
 */
@ApplicationScoped
public class PlatformEventLog {

    private final EntityManager entityManager;
    private final EventSubscribers subscribers;
    private final ObjectMapper json;

    public PlatformEventLog(EntityManager entityManager, EventSubscribers subscribers, ObjectMapper json) {
        this.entityManager = entityManager;
        this.subscribers = subscribers;
        this.json = json;
    }

    /** Raises an event of the kernel in an organization. */
    public void raise(UUID organization, String type, Map<String, ?> payload) {
        raise(organization, type, PlatformEvents.KERNEL, payload);
    }

    /**
     * Raises an event in an organization, from a source ({@code kernel} or an extension), in the
     * transaction of the caller.
     */
    @Transactional
    public void raise(UUID organization, String type, String source, Map<String, ?> payload) {
        Objects.requireNonNull(organization, "organization");
        List<String> keys = subscribers.of(type);
        if (keys.isEmpty()) {
            return;
        }
        entityManager
                .createNativeQuery("select {h-schema}platform_event_raise(:organization, :type, :source, :payload,"
                        + " :subscribers)")
                .setParameter("organization", organization)
                .setParameter("type", type)
                .setParameter("source", source)
                .setParameter("payload", write(payload))
                .setParameter("subscribers", String.join(",", keys))
                .getSingleResult();
    }

    /** The payload as JSON. */
    String write(Map<String, ?> payload) {
        try {
            return json.writeValueAsString(payload == null ? Map.of() : payload);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("The payload must be writable as JSON: " + e.getOriginalMessage(), e);
        }
    }
}
