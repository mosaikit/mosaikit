// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.versions;

import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.api.extension.ResourceTypeEntry;
import dev.mosaikit.kernel.api.extension.SharingLevelEntry;
import dev.mosaikit.kernel.api.extension.SubjectKind;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The rules of the version history that need no database (MK-096). */
@Tag("MK-096")
class KernelVersionsTest {

    private static SharingLevelEntry level(String name, boolean edits) {
        return new SharingLevelEntry(name, name, edits, Map.of());
    }

    private static ResourceTypeEntry type(SharingLevelEntry... levels) {
        return new ResourceTypeEntry("doc", "Doc", List.of(levels), Set.of(SubjectKind.PERSON), null, Map.of());
    }

    @Test
    void theOldestVersionsOverTheLimitArePrunedNeverTheNewest() {
        List<Integer> newestFirst = List.of(5, 4, 3, 2, 1);
        assertThat(KernelVersions.toPrune(newestFirst, 3)).containsExactly(1, 2);
        assertThat(KernelVersions.toPrune(newestFirst, 5)).isEmpty();
        assertThat(KernelVersions.toPrune(newestFirst, 9)).isEmpty();
        assertThat(KernelVersions.toPrune(newestFirst, 1)).containsExactly(1, 2, 3, 4);
    }

    @Test
    void aLimitBelowOneIsAMistakeAndPrunesNothing() {
        List<Integer> newestFirst = List.of(3, 2, 1);
        assertThat(KernelVersions.toPrune(newestFirst, 0)).isEmpty();
        assertThat(KernelVersions.toPrune(newestFirst, -4)).isEmpty();
    }

    @Test
    void editRightsAreTheLowestLevelThatEditsOrTheHighest() {
        assertThat(KernelVersions.editing(type(level("view", false), level("edit", true), level("manage", true))))
                .isEqualTo("edit");
        assertThat(KernelVersions.editing(type(level("view", false), level("use", false))))
                .isEqualTo("use");
        assertThat(KernelVersions.lowest(type(level("view", false), level("edit", true))))
                .isEqualTo("view");
    }
}
