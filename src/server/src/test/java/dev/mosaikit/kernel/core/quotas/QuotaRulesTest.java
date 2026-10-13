// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.quotas;

import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.QuotaExceededException;
import io.quarkus.runtime.configuration.MemorySize;
import java.math.BigInteger;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.OptionalLong;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The rules of quotas that need no database (MK-076). */
@Tag("MK-076")
class QuotaRulesTest {

    static final Measure RENDERS =
            new Measure("org.example.maps/renders", "Renders", "renders", Measure.Kind.COUNTER, "org.example.maps");

    record Defaults(Optional<MemorySize> storage, Map<String, Long> limits) implements KernelConfig.Quotas {}

    @Test
    void amountsAreShownInTheUnitOfTheMeasure() {
        assertThat(Measure.STORAGE.format(1023)).isEqualTo("1023 bytes");
        assertThat(Measure.STORAGE.format(1024)).isEqualTo("1 KB");
        assertThat(Measure.STORAGE.format(1_572_864)).isEqualTo("1.5 MB");
        assertThat(Measure.STORAGE.format(10L << 30)).isEqualTo("10 GB");
        assertThat(RENDERS.format(1000)).isEqualTo("1000 renders");
        assertThat(Measure.of("org.example.maps", "renders")).isEqualTo(RENDERS.id());
        assertThat(Measure.Kind.COUNTER.value()).isEqualTo("counter");
    }

    @Test
    void anActionFitsWhatIsLeft() {
        var none = new QuotaService.Check(RENDERS, "2026-10", OptionalLong.empty(), 5000, 1);
        assertThat(none.fits()).isTrue();
        assertThat(none.remaining()).isEmpty();

        var exact = new QuotaService.Check(RENDERS, "2026-10", OptionalLong.of(10), 7, 3);
        assertThat(exact.fits()).isTrue();
        assertThat(exact.remaining()).hasValue(3);

        var over = new QuotaService.Check(RENDERS, "2026-10", OptionalLong.of(10), 12, 1);
        assertThat(over.fits()).isFalse();
        assertThat(over.remaining()).hasValue(0);
    }

    @Test
    void aRefusalNamesTheLimit() {
        QuotaExceededException counter =
                new QuotaService.Check(RENDERS, "2026-10", OptionalLong.of(10), 8, 5).refusal();
        assertThat(counter.status()).isEqualTo(403);
        assertThat(counter.title()).isEqualTo("Quota exceeded");
        assertThat(counter.getMessage())
                .isEqualTo("The organization may use 10 renders of Renders (org.example.maps/renders) in 2026-10:"
                        + " it used 8 renders, and this needs 5 renders more.");
        assertThat(counter.quota())
                .isEqualTo(
                        new QuotaExceededException.Quota("org.example.maps/renders", "renders", "2026-10", 10, 8, 5));

        QuotaExceededException storage =
                new QuotaService.Check(Measure.STORAGE, null, OptionalLong.of(2 << 20), 1_572_864, 600 << 10).refusal();
        assertThat(storage.getMessage())
                .isEqualTo("The organization may keep 2 MB of Storage (storage): it keeps 1.5 MB, and this needs"
                        + " 600 KB more.");
    }

    @Test
    void theInstallationGivesTheDefaultLimits() {
        var defaults = new Defaults(
                Optional.of(new MemorySize(BigInteger.valueOf(10_000))), Map.of("org.example.maps/renders", 500L));
        assertThat(QuotaService.defaultLimit(defaults, Measure.STORAGE)).hasValue(10_000);
        assertThat(QuotaService.defaultLimit(defaults, RENDERS)).hasValue(500);
        var none = new Defaults(Optional.empty(), Map.of());
        assertThat(QuotaService.defaultLimit(none, Measure.STORAGE)).isEmpty();
        assertThat(QuotaService.defaultLimit(none, RENDERS)).isEmpty();
    }

    @Test
    void theCatalogStartsWithStorage() {
        var measures = new Measures(() -> List.of(RENDERS));
        assertThat(measures.all()).containsExactly(Measure.STORAGE, RENDERS);
        assertThat(measures.find("storage")).contains(Measure.STORAGE);
        assertThat(measures.find("org.example.maps/calls")).isEmpty();
        assertThat(new Measures(List::of).all()).containsExactly(Measure.STORAGE);
    }
}
