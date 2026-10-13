// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.mosaikit.kernel.core.error.InvalidInputException;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** Creation, memory, use and revocation of personal access keys (MK-060), with a store in memory. */
@Tag("MK-060")
class AccessKeyRegistryTest {

    private static final Instant START = Instant.parse("2026-10-13T08:00:00Z");
    private static final UUID ACCOUNT = UUID.randomUUID();
    private static final UUID ACME = UUID.randomUUID();
    private static final UUID GREEN = UUID.randomUUID();

    /** A clock the test moves. */
    private static final class MovingClock extends Clock {
        Instant now = START;

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    /** Keys in a list; counts the reads by digest and the writes of their last use. */
    private static final class MemoryStore extends AccessKeyStore {
        final List<AccessKey> keys = new ArrayList<>();
        final List<String> digests = new ArrayList<>();
        int reads;
        int touches;

        MemoryStore() {
            super(null);
        }

        @Override
        Optional<AccessKey> byDigest(String digest) {
            reads++;
            int index = digests.indexOf(digest);
            return index < 0 ? Optional.empty() : Optional.of(keys.get(index));
        }

        @Override
        Optional<AccessKey> byId(UUID id) {
            return keys.stream().filter(key -> key.getId().equals(id)).findFirst();
        }

        @Override
        void insert(AccessKey key) {
            keys.add(key);
            digests.add(digestOf(key));
        }

        @Override
        List<AccessKey> notRevoked(UUID accountId) {
            return keys.stream()
                    .filter(key -> key.getAccountId().equals(accountId))
                    .filter(key -> key.getRevokedAt().isEmpty())
                    .sorted(Comparator.comparing(AccessKey::getCreatedAt).reversed())
                    .toList();
        }

        @Override
        void touch(UUID id, Instant now) {
            touches++;
            byId(id).ifPresent(key -> key.markUsed(now));
        }

        @Override
        boolean revoke(UUID id, Instant now) {
            byId(id).ifPresent(key -> key.markRevoked(now));
            return true;
        }

        @Override
        void revokeAllOf(UUID accountId, Instant now) {
            keys.stream().filter(key -> key.getAccountId().equals(accountId)).forEach(key -> key.markRevoked(now));
        }

        @Override
        void revokeIn(UUID accountId, UUID organizationId, Instant now) {
            keys.stream()
                    .filter(key -> key.getAccountId().equals(accountId))
                    .filter(key -> key.getOrganizationId().equals(organizationId))
                    .forEach(key -> key.markRevoked(now));
        }

        private static String digestOf(AccessKey key) {
            try {
                var field = AccessKey.class.getDeclaredField("tokenDigest");
                field.setAccessible(true);
                return (String) field.get(key);
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    private final MovingClock clock = new MovingClock();
    private final MemoryStore store = new MemoryStore();
    private final AccessKeyRegistry registry =
            new AccessKeyRegistry(store, clock, Duration.ofDays(365), Duration.ofSeconds(5));

    @Test
    void showsTheSecretOnceAndKeepsOnlyItsDigest() {
        var created = registry.create(ACCOUNT, ACME, "  Nightly export  ", null, false);

        assertThat(created.secret()).startsWith(AccessKeyRegistry.KEY_START).hasSizeGreaterThanOrEqualTo(46);
        assertThat(created.toString()).doesNotContain(created.secret());
        AccessKey key = created.key();
        assertThat(key.getName()).isEqualTo("Nightly export");
        assertThat(key.getPrefix()).isEqualTo(created.secret().substring(0, AccessKeyRegistry.PREFIX_LENGTH));
        assertThat(MemoryStore.digestOf(key))
                .isEqualTo(RememberMe.digest(created.secret()))
                .doesNotContain(created.secret().substring(AccessKeyRegistry.PREFIX_LENGTH));
        // Without an expiry, the longest the installation allows.
        assertThat(key.getExpiresAt()).isEqualTo(START.plus(Duration.ofDays(365)));
        assertThat(key.canWrite()).isFalse();
        assertThat(registry.find(created.secret())).get().satisfies(found -> {
            assertThat(found.live(START)).isTrue();
            assertThat(found.organizationId()).isEqualTo(ACME);
        });
    }

    @Test
    void refusesANameMissingAndAnExpiryPastTheMaximum() {
        assertThatThrownBy(() -> registry.create(ACCOUNT, ACME, " ", null, false))
                .isInstanceOf(InvalidInputException.class);
        assertThatThrownBy(() -> registry.create(ACCOUNT, ACME, "x".repeat(101), null, false))
                .isInstanceOf(InvalidInputException.class);
        assertThatThrownBy(() -> registry.create(ACCOUNT, ACME, "Late", START.plus(Duration.ofDays(366)), false))
                .isInstanceOf(InvalidInputException.class)
                .hasMessageContaining("365 days");
        assertThatThrownBy(() -> registry.create(ACCOUNT, ACME, "Past", START, false))
                .isInstanceOf(InvalidInputException.class);

        var monthly = registry.create(ACCOUNT, ACME, "Monthly", START.plus(Duration.ofDays(30)), true);
        assertThat(monthly.key().getExpiresAt()).isEqualTo(START.plus(Duration.ofDays(30)));
        assertThat(monthly.key().canWrite()).isTrue();
    }

    @Test
    void recognizesOnlyItsOwnKeys() {
        assertThat(AccessKeyRegistry.looksLikeKey("mk_abc")).isTrue();
        assertThat(AccessKeyRegistry.looksLikeKey("eyJhbGciOi")).isFalse();
        assertThat(AccessKeyRegistry.looksLikeKey(null)).isFalse();
        assertThat(registry.find("eyJhbGciOi")).isEmpty();
        assertThat(registry.find("mk_" + "x".repeat(200))).isEmpty();
        assertThat(registry.find("mk_never-issued")).isEmpty();
    }

    @Test
    void anExpiredKeyIsNoLongerLive() {
        var created = registry.create(ACCOUNT, ACME, "Short", START.plus(Duration.ofHours(1)), false);
        clock.now = START.plus(Duration.ofHours(1));
        assertThat(registry.find(created.secret()))
                .get()
                .satisfies(found -> assertThat(found.live(clock.now)).isFalse());
    }

    @Test
    void keepsAKeyInMemoryForAFewSecondsAndForgetsItWhenRevoked() {
        var created = registry.create(ACCOUNT, ACME, "Script", null, false);
        registry.find(created.secret());
        registry.find(created.secret());
        assertThat(store.reads).isEqualTo(1);

        clock.now = START.plusSeconds(6);
        registry.find(created.secret());
        assertThat(store.reads).isEqualTo(2);

        // Revoked here: refused at the next request, without waiting for the memory to expire.
        assertThat(registry.revokeOwn(ACCOUNT, created.key().getId())).isPresent();
        assertThat(registry.find(created.secret())).get().satisfies(found -> {
            assertThat(found.revoked()).isTrue();
            assertThat(found.live(clock.now)).isFalse();
        });
        assertThat(registry.of(ACCOUNT)).isEmpty();
        // Revoked once only, and only by its person.
        assertThat(registry.revokeOwn(ACCOUNT, created.key().getId())).isEmpty();
        var other = registry.create(ACCOUNT, ACME, "Other", null, false);
        assertThat(registry.revokeOwn(UUID.randomUUID(), other.key().getId())).isEmpty();
    }

    @Test
    void writesTheLastUseAtMostOnceAMinute() {
        var created = registry.create(ACCOUNT, ACME, "Polling", null, false);
        registry.used(registry.find(created.secret()).orElseThrow());
        clock.now = START.plusSeconds(30);
        registry.used(registry.find(created.secret()).orElseThrow());
        assertThat(store.touches).isEqualTo(1);

        clock.now = START.plusSeconds(61);
        registry.used(registry.find(created.secret()).orElseThrow());
        assertThat(store.touches).isEqualTo(2);
        assertThat(created.key().getLastUsedAt()).contains(START.plusSeconds(61));
    }

    @Test
    void leavingAnOrganizationRevokesOnlyTheKeysInItAndASuspensionAllOfThem() {
        var acme = registry.create(ACCOUNT, ACME, "Acme", null, false);
        var green = registry.create(ACCOUNT, GREEN, "Green", null, true);
        registry.find(acme.secret());
        registry.find(green.secret());

        registry.revokeIn(ACCOUNT, ACME);
        assertThat(registry.find(acme.secret()).orElseThrow().live(START)).isFalse();
        assertThat(registry.find(green.secret()).orElseThrow().live(START)).isTrue();

        registry.revokeAllOf(ACCOUNT);
        assertThat(registry.find(green.secret()).orElseThrow().live(START)).isFalse();
    }

    @Test
    void readsTheKeyOfAnAuthorizationHeader() {
        assertThat(AccessKeyMechanism.key("Bearer mk_abc")).contains("mk_abc");
        assertThat(AccessKeyMechanism.key("bearer  mk_abc ")).contains("mk_abc");
        assertThat(AccessKeyMechanism.key("Bearer eyJhbGciOi")).isEmpty();
        assertThat(AccessKeyMechanism.key("Basic bWtfYWJj")).isEmpty();
        assertThat(AccessKeyMechanism.key("Bearer")).isEmpty();
        assertThat(AccessKeyMechanism.key(null)).isEmpty();
    }

    @Test
    void keepsKeysAwayFromSessionsAndKeys() {
        assertThat(AccessKeyGuard.notWithAKey("/api/v1/accounts/session")).isTrue();
        assertThat(AccessKeyGuard.notWithAKey("/api/v1/accounts/session/remembrance"))
                .isTrue();
        assertThat(AccessKeyGuard.notWithAKey("/api/v1/accounts/me/sessions/x")).isTrue();
        assertThat(AccessKeyGuard.notWithAKey("/api/v1/accounts/me/access-keys"))
                .isTrue();
        assertThat(AccessKeyGuard.notWithAKey("/api/v1/accounts/me")).isFalse();
        assertThat(AccessKeyGuard.notWithAKey("/api/v1/access-keys/current")).isFalse();
        assertThat(AccessKeyGuard.notWithAKey(null)).isFalse();
    }
}
