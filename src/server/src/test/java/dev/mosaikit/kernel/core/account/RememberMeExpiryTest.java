// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import static org.assertj.core.api.Assertions.assertThat;

import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@QuarkusTest
@Tag("MK-047")
class RememberMeExpiryTest {

    @Inject
    RememberTokens tokens;

    @Inject
    UserAccounts accounts;

    @Test
    void signsInOnlyUntilTheTokenExpires() {
        Instant start = Instant.now();
        var past = new RememberMe(
                tokens, accounts, Duration.ofDays(30), Clock.fixed(start.minus(Duration.ofDays(31)), ZoneOffset.UTC));
        var now = new RememberMe(tokens, accounts, Duration.ofDays(30), Clock.fixed(start, ZoneOffset.UTC));

        String old =
                QuarkusTransaction.requiringNew().call(() -> past.issue("admin").orElseThrow());
        String fresh =
                QuarkusTransaction.requiringNew().call(() -> now.issue("admin").orElseThrow());

        assertThat(QuarkusTransaction.requiringNew().call(() -> now.accountOf(old)))
                .isEmpty();
        assertThat(QuarkusTransaction.requiringNew().call(() -> now.accountOf(fresh)))
                .map(UserAccount::getUsername)
                .contains("admin");
        assertThat(QuarkusTransaction.requiringNew().call(() -> now.issue("nobody@example.org")))
                .isEmpty();
        assertThat(RememberMe.digest(fresh)).hasSize(64).doesNotContain(fresh);
    }
}
