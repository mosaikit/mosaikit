// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.UUID;

/**
 * The result of the verification of a chain of the audit log (MK-059).
 *
 * @param intact whether every entry is as it was written
 * @param checked how many entries were found as written, from the first one kept
 * @param firstIndex position of the first entry kept, after those deleted by the retention
 * @param lastIndex position of the last entry appended by the kernel
 * @param altered the first entry that is not as it was written, when one is not
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record AuditVerification(boolean intact, long checked, Long firstIndex, Long lastIndex, Altered altered) {

    /** What is wrong with an entry. */
    public enum Problem {
        /** Its content, or its link to the entry before, is not what was written. */
        CHANGED,
        /** It is not there any more, and the retention did not delete it. */
        MISSING
    }

    /**
     * The first entry that is not as it was written.
     *
     * @param index its position in the chain
     * @param id its id, when the entry is there
     * @param problem what is wrong with it
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Altered(long index, UUID id, Problem problem) {}

    static AuditVerification intact(long checked, long firstIndex, long lastIndex) {
        return new AuditVerification(true, checked, firstIndex, lastIndex, null);
    }

    static AuditVerification altered(long checked, long index, UUID id, Problem problem) {
        return new AuditVerification(false, checked, null, null, new Altered(index, id, problem));
    }
}
