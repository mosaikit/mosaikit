// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.security.SecureRandom;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

@Tag("MK-003")
class PasswordHasherTest {

    /** A low cost keeps the tests fast; the algorithm is the same. */
    private final PasswordHasher hasher = new PasswordHasher(1_000, new SecureRandom());

    @Test
    void verifiesTheOriginalPasswordOnly() {
        String encoded = hasher.hash("correct horse battery staple".toCharArray());

        assertThat(hasher.verify("correct horse battery staple".toCharArray(), encoded))
                .isTrue();
        assertThat(hasher.verify("correct horse battery stapler".toCharArray(), encoded))
                .isFalse();
    }

    @Test
    void usesAFreshSaltEveryTime() {
        char[] password = "same password twice".toCharArray();

        assertThat(hasher.hash(password)).isNotEqualTo(hasher.hash(password));
    }

    @Test
    void encodesAlgorithmAndCost() {
        assertThat(hasher.hash("anything at all".toCharArray())).startsWith("pbkdf2-sha256$1000$");
    }

    @Test
    void verifiesHashesProducedWithAnotherCost() {
        String encoded = new PasswordHasher(2_000, new SecureRandom()).hash("cost changed".toCharArray());

        assertThat(hasher.verify("cost changed".toCharArray(), encoded)).isTrue();
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(
            strings = {
                "garbage",
                "bcrypt$10$a$b",
                "pbkdf2-sha256$abc$AAAA$AAAA",
                "pbkdf2-sha256$0$AAAA$AAAA",
                "pbkdf2-sha256$10$!!$AAAA"
            })
    void rejectsMalformedHashes(String encoded) {
        assertThat(hasher.verify("password".toCharArray(), encoded)).isFalse();
    }

    @Test
    void rejectsNonPositiveCost() {
        var random = new SecureRandom();
        assertThatThrownBy(() -> new PasswordHasher(0, random)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void defaultCostFollowsOwaspRecommendation() {
        assertThat(PasswordHasher.DEFAULT_ITERATIONS).isGreaterThanOrEqualTo(600_000);
    }
}
