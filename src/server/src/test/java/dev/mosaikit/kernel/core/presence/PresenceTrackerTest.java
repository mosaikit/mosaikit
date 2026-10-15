// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.presence;

import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.core.live.LiveEvent;
import dev.mosaikit.kernel.core.live.LiveTopics;
import dev.mosaikit.kernel.core.presence.PresenceNotices.Change;
import dev.mosaikit.kernel.core.presence.PresenceNotices.Reason;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** What changes between two readings of the extensions directory, and who is told (MK-133). */
@Tag("MK-133")
class PresenceTrackerTest {

    static final String CATALOG = "org.example.ext.catalog";
    static final String BOARDS = "org.example.ext.boards";
    static final String PROCESSES = "org.example.ext.processes";
    static final String FILES = "org.example.ext.files";

    @Test
    void tellsInstalledUpdatedRemovedAndIncompatibleExtensions() {
        Map<String, String> before = Map.of(CATALOG, "1.0.0", BOARDS, "1.0.0", FILES, "1.0.0", PROCESSES, "0.1.0");
        Map<String, String> now = Map.of(CATALOG, "1.1.0", PROCESSES, "0.1.0", "org.example.ext.maps", "2.0.0");

        List<Change> changes = PresenceTracker.changes(before, now, Set.of(CATALOG, PROCESSES, FILES));

        assertThat(changes)
                .containsExactly(
                        // Not installed any more.
                        new Change(BOARDS, "1.0.0", null, Reason.REMOVED),
                        new Change(CATALOG, "1.1.0", "1.0.0", Reason.UPDATED),
                        // Still installed, but it cannot run.
                        new Change(FILES, "1.0.0", null, Reason.INCOMPATIBLE),
                        new Change("org.example.ext.maps", "2.0.0", null, Reason.INSTALLED));
        assertThat(PresenceTracker.changes(now, now, Set.of())).isEmpty();
    }

    @Test
    void payloadsSayWhetherItIsActiveAndWhy() {
        assertThat(new Change(CATALOG, "1.1.0", "1.0.0", Reason.UPDATED).payload())
                .containsExactly(
                        Map.entry("extension", CATALOG),
                        Map.entry("version", "1.1.0"),
                        Map.entry("active", true),
                        Map.entry("reason", "updated"),
                        Map.entry("previousVersion", "1.0.0"));
        assertThat(new Change(CATALOG, "1.0.0", null, Reason.DISABLED).payload())
                .containsEntry("active", false)
                .containsEntry("reason", "disabled")
                .doesNotContainKey("previousVersion");
        assertThat(Reason.values())
                .filteredOn(Reason::active)
                .containsExactly(Reason.INSTALLED, Reason.UPDATED, Reason.ENABLED);
    }

    @Test
    void theRealTimeTopicIsOpenToTheWholeOrganizationAndItsGuests() {
        UUID organization = UUID.randomUUID();
        UUID guest = UUID.randomUUID();
        LiveEvent presence = new LiveEvent(LiveTopics.EXTENSIONS, organization, null, Map.of());
        LiveEvent other = new LiveEvent("extension.org.example.ext.catalog.changed", organization, null, Map.of());

        assertThat(presence.reaches(organization, guest, true, Set.of())).isTrue();
        assertThat(presence.reaches(UUID.randomUUID(), guest, true, Set.of())).isFalse();
        assertThat(other.reaches(organization, guest, true, Set.of())).isFalse();
        LiveTopics topics = new LiveTopics(null, null);
        assertThat(topics.refusal(LiveTopics.EXTENSIONS, Optional.of(organization)))
                .isEmpty();
        assertThat(topics.refusal(LiveTopics.EXTENSIONS, Optional.empty())).isPresent();
    }
}
