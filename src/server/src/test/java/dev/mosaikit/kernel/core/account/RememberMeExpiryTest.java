// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import static org.assertj.core.api.Assertions.assertThat;

import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.Callable;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

@QuarkusTest
@Tag("MK-047")
class RememberMeExpiryTest {

    @Inject
    RememberTokens tokens;

    @Inject
    UserAccounts accounts;

    @Inject
    EntityManager entityManager;

    /**
     * Built with {@code new} to fix the clock, the beans have no {@code @KernelWrites} interceptor: each
     * call runs in a transaction of its own as the owner of the tables, as that interceptor does.
     */
    private <T> T asKernel(Callable<T> call) {
        return QuarkusTransaction.requiringNew().call(() -> {
            entityManager
                    .createNativeQuery("select set_config('role', 'none', true)")
                    .getSingleResult();
            return call.call();
        });
    }

    @Test
    void signsInOnlyUntilTheTokenExpires() {
        Instant start = Instant.now();
        var past = new RememberMe(
                tokens, accounts, Duration.ofDays(30), Clock.fixed(start.minus(Duration.ofDays(31)), ZoneOffset.UTC));
        var now = new RememberMe(tokens, accounts, Duration.ofDays(30), Clock.fixed(start, ZoneOffset.UTC));

        String old = asKernel(() -> past.issue("admin").orElseThrow());
        String fresh = asKernel(() -> now.issue("admin").orElseThrow());

        assertThat(asKernel(() -> now.accountOf(old))).isEmpty();
        assertThat(asKernel(() -> now.accountOf(fresh)))
                .map(UserAccount::getUsername)
                .contains("admin");
        assertThat(asKernel(() -> now.issue("nobody@example.org"))).isEmpty();
        assertThat(RememberMe.digest(fresh)).hasSize(64).doesNotContain(fresh);
    }
}
