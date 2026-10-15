// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.resource;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

@Tag("MK-097")
class TagsTest {

    @Test
    void storesATagTrimmedInLowercaseWithOneSpaceBetweenWords() {
        assertThat(Tags.normalize("  Spring \t  PLANS ")).isEqualTo("spring plans");
        assertThat(Tags.normalize("x".repeat(Tags.MAX_LENGTH))).hasSize(Tags.MAX_LENGTH);
    }

    @Test
    void keepsEachTagOnceInAlphabeticalOrder() {
        assertThat(Tags.normalizeAll(List.of("Roses", "garden", "ROSES ", "Garden")))
                .containsExactly("garden", "roses");
        assertThat(Tags.normalizeAll(List.of())).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "a,b", "bell\u0007"})
    void refusesTagsThatAreNotValid(String tag) {
        assertThatThrownBy(() -> Tags.normalize(tag)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void refusesATagTooLong() {
        assertThatThrownBy(() -> Tags.normalize("x".repeat(Tags.MAX_LENGTH + 1)))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
