// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import static org.assertj.core.api.Assertions.assertThat;

import dev.mosaikit.kernel.core.security.PasswordHasher;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.test.junit.QuarkusTest;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import java.net.URI;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Callable;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The link that sets the password of an account an administrator created stops working when it expires. */
@QuarkusTest
@Tag("MK-048")
class PasswordLinkExpiryTest {

    @Inject
    PasswordLinks links;

    @Inject
    UserAccounts accounts;

    @Inject
    PasswordHasher hasher;

    @Inject
    EntityManager entityManager;

    /** Built with {@code new} to fix the clock: each call runs as the owner of the tables. */
    private <T> T asKernel(Callable<T> call) {
        return QuarkusTransaction.requiringNew().call(() -> {
            entityManager
                    .createNativeQuery("select set_config('role', 'none', true)")
                    .getSingleResult();
            return call.call();
        });
    }

    private PasswordLinkService at(Instant instant) {
        return new PasswordLinkService(
                links,
                accounts,
                hasher,
                Duration.ofDays(7),
                Optional.of(URI.create("https://mosaikit.example.org")),
                Clock.fixed(instant, ZoneOffset.UTC));
    }

    private static String tokenOf(String link) {
        return link.substring(link.indexOf("set-password=") + "set-password=".length());
    }

    @Test
    void anExpiredLinkIsRefusedAndAFreshOneWorks() {
        Instant now = Instant.now();
        PasswordLinkService past = at(now.minus(Duration.ofDays(8)));
        PasswordLinkService present = at(now);
        UserAccount account = asKernel(() -> {
            UserAccount created = UserAccount.withoutPassword(UUID.randomUUID() + "@example.org", "Expiring", now);
            accounts.insert(created);
            return created;
        });

        PasswordLinkService.Issued old = asKernel(() -> past.issue(account, null, URI.create("http://localhost/")));
        assertThat(old.link()).startsWith("https://mosaikit.example.org/?set-password=");
        assertThat(old.expiresAt()).isEqualTo(now.minus(Duration.ofDays(1)));
        assertThat(asKernel(() -> present.use(tokenOf(old.link()), "a long enough password".toCharArray())))
                .isEmpty();
        assertThat(asKernel(
                        () -> accounts.findById(account.getId()).orElseThrow().getPasswordHash()))
                .isEmpty();

        PasswordLinkService.Issued fresh =
                asKernel(() -> present.issue(account, null, URI.create("http://localhost/")));
        assertThat(asKernel(() -> present.use(tokenOf(fresh.link()), "a long enough password".toCharArray())))
                .map(used -> used.account().getId())
                .contains(account.getId());
        assertThat(asKernel(
                        () -> accounts.findById(account.getId()).orElseThrow().getPasswordHash()))
                .isPresent();
        assertThat(fresh.toString()).doesNotContain(tokenOf(fresh.link()));
    }
}
