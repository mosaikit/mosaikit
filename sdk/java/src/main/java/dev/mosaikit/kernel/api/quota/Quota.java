// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.quota;

import java.util.Objects;
import java.util.OptionalLong;

/**
 * What an amount does to a quota of the organization of the request (MK-076).
 *
 * @param measure the measure in the kernel: {@code storage}, or {@code <extension>/<id>}
 * @param unit its unit, such as {@code bytes} or {@code calls}
 * @param period the month of a counter, such as {@code 2026-10}, or {@code null} for a gauge
 * @param limit the limit of the organization, empty when there is none
 * @param used what the organization used in the period, or keeps now, before the amount
 * @param requested the amount asked about
 */
public record Quota(String measure, String unit, String period, OptionalLong limit, long used, long requested) {

    public Quota {
        Objects.requireNonNull(measure, "measure");
        Objects.requireNonNull(unit, "unit");
        Objects.requireNonNull(limit, "limit");
    }

    /** Whether the amount fits the limit; always without a limit. */
    public boolean fits() {
        return limit.isEmpty() || used + requested <= limit.getAsLong();
    }

    /** What is left before the limit, never negative; empty without a limit. */
    public OptionalLong remaining() {
        return limit.isEmpty() ? OptionalLong.empty() : OptionalLong.of(Math.max(0, limit.getAsLong() - used));
    }
}
