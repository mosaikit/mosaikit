// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.events;

import java.time.Instant;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * An event of the platform, as a subscriber receives it (MK-085).
 *
 * @param id identifier of the event, the same at every delivery of it: keep the identifiers already
 *     handled, or make the work idempotent, since an event may arrive more than once
 * @param organization the organization where it happened, which the handler acts on
 * @param type its type, such as {@value PlatformEvents#ORGANIZATION_CREATED}, or
 *     {@code <extension>:<name>} for an event of an extension
 * @param source {@value PlatformEvents#KERNEL} for the events of the kernel, otherwise the extension
 *     that raised it
 * @param payload what happened, as read from JSON: strings, numbers, booleans, lists and maps
 * @param occurredAt when it was raised
 * @param attempt how many times it was given to this subscriber, this one included, from 1
 */
public record PlatformEvent(
        long id,
        UUID organization,
        String type,
        String source,
        Map<String, Object> payload,
        Instant occurredAt,
        int attempt) {

    public PlatformEvent {
        Objects.requireNonNull(organization, "organization");
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(source, "source");
        Objects.requireNonNull(occurredAt, "occurredAt");
        payload = payload == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(payload));
    }

    /** A value of the payload as text, or {@code null} when it has none by that name. */
    public String text(String name) {
        Object value = payload.get(name);
        return value == null ? null : value.toString();
    }
}
