// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.events;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.HashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@Tag("MK-085")
class PlatformEventTest {

    private static final UUID ACME = UUID.randomUUID();

    @Test
    void keepsAnUnchangeableCopyOfThePayload() {
        Map<String, Object> payload = new HashMap<>(Map.of("slug", "acme", "size", 5));
        PlatformEvent event = new PlatformEvent(
                1, ACME, PlatformEvents.ORGANIZATION_CREATED, PlatformEvents.KERNEL, payload, Instant.EPOCH, 1);
        payload.put("slug", "changed");

        assertThat(event.text("slug")).isEqualTo("acme");
        assertThat(event.text("size")).isEqualTo("5");
        assertThat(event.text("missing")).isNull();
        assertThatThrownBy(() -> event.payload().put("x", 1)).isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void hasAnEmptyPayloadForNone() {
        PlatformEvent event = new PlatformEvent(
                1, ACME, "dev.example.notes:note.created", "dev.example.notes", null, Instant.EPOCH, 2);

        assertThat(event.payload()).isEmpty();
    }

    @Test
    void needsItsOrganizationTypeSourceAndTime() {
        assertThatThrownBy(() -> new PlatformEvent(1, null, "t", "kernel", Map.of(), Instant.EPOCH, 1))
                .isInstanceOf(NullPointerException.class);
        assertThatThrownBy(() -> new PlatformEvent(1, ACME, null, "kernel", Map.of(), Instant.EPOCH, 1))
                .isInstanceOf(NullPointerException.class);
        assertThatThrownBy(() -> new PlatformEvent(1, ACME, "t", null, Map.of(), Instant.EPOCH, 1))
                .isInstanceOf(NullPointerException.class);
        assertThatThrownBy(() -> new PlatformEvent(1, ACME, "t", "kernel", Map.of(), null, 1))
                .isInstanceOf(NullPointerException.class);
    }

    @Test
    void aSubscriberIsNamedDefaultUnlessItSaysOtherwise() {
        PlatformEventSubscriber subscriber = new PlatformEventSubscriber() {
            @Override
            public String extension() {
                return "dev.example.notes";
            }

            @Override
            public Set<String> types() {
                return Set.of(PlatformEvents.FILE_STORED);
            }

            @Override
            public void handle(PlatformEvent event) {
                // Nothing to do.
            }
        };

        assertThat(subscriber.name()).isEqualTo("default");
    }
}
