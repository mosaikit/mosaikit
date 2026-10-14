// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Which uses of a key to audit: the first one of each period, as for access keys (MK-060), so that a
 * viewer that fetches many tiles through one link does not write an entry for each. The memory is of
 * this node, and bounded: past {@code remembered} keys it forgets the old ones, and at worst audits a
 * use again. Refusals are not counted here: the callers audit every one.
 */
public final class FirstUses {

    private final Duration every;
    private final int remembered;
    private final Map<String, Instant> audited = new ConcurrentHashMap<>();

    /**
     * @param every how often the use of one key is audited, at most
     * @param remembered how many keys the memory keeps before it forgets the old ones
     */
    public FirstUses(Duration every, int remembered) {
        this.every = every;
        this.remembered = remembered;
    }

    /** Whether this use of a key is the first one of its period, and so to audit. */
    public boolean first(String key, Instant now) {
        if (audited.size() >= remembered && !audited.containsKey(key)) {
            audited.values().removeIf(at -> !now.isBefore(at.plus(every)));
            if (audited.size() >= remembered) {
                audited.clear();
            }
        }
        boolean[] first = {false};
        audited.compute(key, (ignored, last) -> {
            if (last == null || !now.isBefore(last.plus(every))) {
                first[0] = true;
                return now;
            }
            return last;
        });
        return first[0];
    }
}
