// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.audit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

@Tag("MK-059")
class AuditLogTest {

    @Test
    void anEntrySaysTheActionItsObjectAndHowItEnded() {
        AuditLog.Entry entry = AuditLog.Entry.of("dashboard.exported", "dashboard/42");

        assertThat(entry.action()).isEqualTo("dashboard.exported");
        assertThat(entry.object()).isEqualTo("dashboard/42");
        assertThat(entry.outcome()).isEqualTo(AuditLog.Outcome.SUCCEEDED);
        assertThat(entry.details()).isEmpty();
    }

    @Test
    void keepsACopyOfTheDetails() {
        Map<String, Object> details = new HashMap<>();
        details.put("format", "csv");
        details.put("note", null);
        AuditLog.Entry entry = new AuditLog.Entry("dashboard.exported", null, AuditLog.Outcome.DENIED, details);
        details.put("format", "pdf");

        assertThat(entry.details().get("format")).isEqualTo("csv");
        assertThat(entry.details()).containsKey("note");
        assertThatThrownBy(() -> entry.details().clear()).isInstanceOf(UnsupportedOperationException.class);
        assertThat(new AuditLog.Entry("a", null, AuditLog.Outcome.FAILED, null).details())
                .isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "Dashboard.exported", "1st", "dashboard exported", "dashboard:exported"})
    void refusesActionsThatAreNotStableNames(String action) {
        assertThatThrownBy(() -> AuditLog.Entry.of(action, null)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void refusesAnObjectTooLongOrBlankAndAMissingOutcome() {
        assertThatThrownBy(() -> AuditLog.Entry.of("a", "x".repeat(AuditLog.MAX_OBJECT + 1)))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AuditLog.Entry.of("a", " ")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> AuditLog.Entry.of(null, "x")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new AuditLog.Entry("a", "x", null, Map.of()))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
