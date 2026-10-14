// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/**
 * The first use of a link in each hour is audited, not every one (#96): a map read through a link asks
 * for every tile with it.
 */
@Tag("MK-055")
@Tag("MK-093")
class FirstUsesTest {

    private static final Instant NOON = Instant.parse("2026-10-14T12:00:00Z");

    @Test
    void onlyTheFirstUseOfEachPeriodIsAudited() {
        FirstUses uses = new FirstUses(Duration.ofHours(1), 100);

        assertThat(uses.first("a", NOON)).isTrue();
        assertThat(uses.first("a", NOON.plusSeconds(1))).isFalse();
        assertThat(uses.first("a", NOON.plus(Duration.ofMinutes(59)))).isFalse();
        // Another link has its own first use.
        assertThat(uses.first("b", NOON.plusSeconds(1))).isTrue();
        // An hour later, the next use is audited again.
        assertThat(uses.first("a", NOON.plus(Duration.ofHours(1)))).isTrue();
        assertThat(uses.first("a", NOON.plus(Duration.ofMinutes(61)))).isFalse();
    }

    @Test
    void manyTilesAtOnceWriteOneEntry() {
        FirstUses uses = new FirstUses(Duration.ofHours(1), 100);
        ConcurrentLinkedQueue<Integer> audited = new ConcurrentLinkedQueue<>();

        IntStream.range(0, 500).parallel().forEach(tile -> {
            if (uses.first("map", NOON)) {
                audited.add(tile);
            }
        });

        assertThat(audited).hasSize(1);
    }

    @Test
    void aFullMemoryForgetsTheOldUsesAndAtWorstAuditsAgain() {
        FirstUses uses = new FirstUses(Duration.ofHours(1), 3);
        uses.first("a", NOON);
        uses.first("b", NOON.plus(Duration.ofMinutes(30)));
        uses.first("c", NOON.plus(Duration.ofMinutes(50)));

        // Full: "a" is past its hour and forgotten, the others are kept.
        assertThat(uses.first("d", NOON.plus(Duration.ofMinutes(70)))).isTrue();
        assertThat(uses.first("b", NOON.plus(Duration.ofMinutes(71)))).isFalse();
        assertThat(uses.first("c", NOON.plus(Duration.ofMinutes(72)))).isFalse();

        // Full of recent uses: everything is forgotten, and the next uses are audited again.
        assertThat(uses.first("e", NOON.plus(Duration.ofMinutes(73)))).isTrue();
        assertThat(uses.first("b", NOON.plus(Duration.ofMinutes(74)))).isTrue();
    }
}
