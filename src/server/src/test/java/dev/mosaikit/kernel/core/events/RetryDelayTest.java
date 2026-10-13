// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.events;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** A failed delivery waits twice as long after each attempt, never more than an hour (MK-085). */
@Tag("MK-085")
class RetryDelayTest {

    @Test
    void doublesAfterEachAttemptUpToAnHour() {
        Duration first = Duration.ofSeconds(10);

        assertThat(PlatformEventDispatcher.delay(first, 1)).isEqualTo(Duration.ofSeconds(10));
        assertThat(PlatformEventDispatcher.delay(first, 2)).isEqualTo(Duration.ofSeconds(20));
        assertThat(PlatformEventDispatcher.delay(first, 4)).isEqualTo(Duration.ofSeconds(80));
        assertThat(PlatformEventDispatcher.delay(first, 30)).isEqualTo(Duration.ofHours(1));
        assertThat(PlatformEventDispatcher.delay(Duration.ofHours(2), 1)).isEqualTo(Duration.ofHours(1));
    }

    @Test
    void namesTheExtensionOfASubscriber() {
        assertThat(EventSubscribers.extensionOf("dev.example.notes/default")).isEqualTo("dev.example.notes");
    }
}
