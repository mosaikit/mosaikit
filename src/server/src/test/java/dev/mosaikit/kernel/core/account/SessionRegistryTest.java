// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;

/** The lifetimes of sessions and the memory of the registry (MK-125), with a store in memory. */
@Tag("MK-125")
class SessionRegistryTest {

    private static final Instant START = Instant.parse("2026-10-13T08:00:00Z");
    private static final UUID ACCOUNT = UUID.randomUUID();

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

    /** Sessions in a map; counts the reads by digest. */
    private static final class MemoryStore extends SessionStore {
        final Map<String, AccountSession> byDigest = new HashMap<>();
        final Map<UUID, Instant> ended = new HashMap<>();
        int reads;
        int touches;

        MemoryStore() {
            super(null, null);
        }

        @Override
        Optional<AccountSession> byDigest(String digest) {
            reads++;
            return Optional.ofNullable(byDigest.get(digest)).map(this::withEnd);
        }

        @Override
        Optional<AccountSession> byId(UUID id) {
            return byDigest.values().stream()
                    .filter(session -> session.getId().equals(id))
                    .findFirst()
                    .map(this::withEnd);
        }

        @Override
        void insert(AccountSession session) {
            byDigest.put(digestOf(session), session);
        }

        @Override
        void touch(UUID id, UUID organizationId, Instant now) {
            touches++;
        }

        @Override
        boolean end(UUID id, Instant now, Instant keepRealmUntil) {
            return ended.putIfAbsent(id, now) == null;
        }

        @Override
        void endAllOf(UUID accountId, Instant now, Instant keepRealmUntil) {
            byDigest.values().forEach(session -> ended.putIfAbsent(session.getId(), now));
        }

        @Override
        List<AccountSession> open(UUID accountId, Instant now) {
            return byDigest.values().stream().map(this::withEnd).toList();
        }

        private AccountSession withEnd(AccountSession session) {
            if (!ended.containsKey(session.getId())) {
                return session;
            }
            return new AccountSession(
                    session.getAccountId(),
                    null,
                    digestOf(session),
                    session.getKind(),
                    SessionClient.UNKNOWN,
                    session.getCreatedAt(),
                    session.getExpiresAt()) {
                @Override
                public UUID getId() {
                    return session.getId();
                }

                @Override
                public Optional<Instant> getEndedAt() {
                    return Optional.of(ended.get(session.getId()));
                }
            };
        }

        private String digestOf(AccountSession session) {
            try {
                var field = AccountSession.class.getDeclaredField("tokenDigest");
                field.setAccessible(true);
                return (String) field.get(session);
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            }
        }
    }

    private final MovingClock clock = new MovingClock();
    private final MemoryStore store = new MemoryStore();
    private final SessionRegistry registry =
            new SessionRegistry(store, clock, Duration.ofHours(8), Duration.ofHours(24), Duration.ofSeconds(5));

    @Test
    void readsASessionAgainOnlyAfterTheCacheTimeAndAtOnceAfterItsEnd() {
        var opened = registry.open(ACCOUNT, null, new SessionClient("Browser", "192.0.2.1"));
        assertThat(opened.toString()).doesNotContain(opened.token());

        assertThat(registry.byCookie(opened.token())).isPresent();
        assertThat(registry.byCookie(opened.token())).isPresent();
        assertThat(store.reads).isEqualTo(1);

        clock.now = clock.now.plusSeconds(6);
        assertThat(registry.byCookie(opened.token())).isPresent();
        assertThat(store.reads).isEqualTo(2);

        // Ended on this kernel: refused at once, although the memory was fresh.
        assertThat(registry.end(opened.id())).isTrue();
        assertThat(registry.byCookie(opened.token())).isEmpty();
    }

    @Test
    void forgetsEverySessionOfASuspendedAccount() {
        var first = registry.open(ACCOUNT, null, SessionClient.UNKNOWN);
        var second = registry.open(ACCOUNT, null, SessionClient.UNKNOWN);
        assertThat(registry.byCookie(first.token())).isPresent();
        assertThat(registry.byCookie(second.token())).isPresent();

        registry.endAllOf(ACCOUNT);

        assertThat(registry.byCookie(first.token())).isEmpty();
        assertThat(registry.byCookie(second.token())).isEmpty();
        assertThat(registry.liveOf(ACCOUNT)).isEmpty();
    }

    @Test
    void endsAPasswordSessionAfterTheTimeoutOrTheMaximumLife() {
        var idle = registry.open(ACCOUNT, null, SessionClient.UNKNOWN);
        clock.now = START.plus(Duration.ofHours(8)).plusSeconds(1);
        assertThat(registry.byCookie(idle.token())).isEmpty();

        // Active all the time, a session still ends after its maximum life.
        clock.now = START;
        var busy = registry.open(ACCOUNT, null, SessionClient.UNKNOWN);
        SessionRegistry.Active active = registry.byCookie(busy.token()).orElseThrow();
        assertThat(registry.live(
                        new SessionRegistry.Active(
                                active.id(),
                                active.digest(),
                                ACCOUNT,
                                null,
                                AccountSession.PASSWORD,
                                START.plus(Duration.ofHours(23)),
                                active.expiresAt(),
                                false),
                        START.plus(Duration.ofHours(24))))
                .isFalse();
    }

    @Test
    void writesTheLastRequestAtMostOnceAMinuteUnlessTheOrganizationChanges() {
        var opened = registry.open(ACCOUNT, null, SessionClient.UNKNOWN);
        SessionRegistry.Active active = registry.byCookie(opened.token()).orElseThrow();

        clock.now = START.plusSeconds(30);
        registry.seen(active, null);
        assertThat(store.touches).isZero();

        registry.seen(active, UUID.randomUUID());
        assertThat(store.touches).isEqualTo(1);

        clock.now = START.plusSeconds(61);
        registry.seen(active, null);
        assertThat(store.touches).isEqualTo(2);
    }

    @Test
    void keepsARealmSessionAsLongAsTheRealmAndRefusesItOnceEnded() {
        UUID organization = UUID.randomUUID();
        var session = registry.ofRealm(
                ACCOUNT, organization, "https://id.example.org/realms/acme", "sid-1", SessionClient.UNKNOWN);
        assertThat(session).isPresent();
        // No timeout of the kernel: the realm decides.
        clock.now = START.plus(Duration.ofHours(10));
        assertThat(registry.ofRealm(
                        ACCOUNT, organization, "https://id.example.org/realms/acme", "sid-1", SessionClient.UNKNOWN))
                .map(SessionRegistry.Active::id)
                .contains(session.get().id());
        // Another account cannot use the session of the realm of someone else.
        assertThat(registry.ofRealm(
                        UUID.randomUUID(),
                        organization,
                        "https://id.example.org/realms/acme",
                        "sid-1",
                        SessionClient.UNKNOWN))
                .isEmpty();

        registry.end(session.get().id());
        assertThat(registry.ofRealm(
                        ACCOUNT, organization, "https://id.example.org/realms/acme", "sid-1", SessionClient.UNKNOWN))
                .isEmpty();
    }

    @Test
    void neverAcceptsATimeoutShorterThanAMinute() {
        var registry = new SessionRegistry(store, clock, Duration.ZERO, Duration.ofSeconds(1), Duration.ZERO);
        var opened = registry.open(ACCOUNT, null, SessionClient.UNKNOWN);
        clock.now = START.plusSeconds(59);
        assertThat(registry.byCookie(opened.token())).isPresent();
    }
}
