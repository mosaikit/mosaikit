// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.config.KernelConfig;
import io.quarkus.scheduler.Scheduled;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Predicate;
import org.jboss.logging.Logger;

/**
 * The sessions of people, kept by the kernel (MK-125), so that signing out, a suspension or the
 * removal from an organization ends them at once, and people see and end their own.
 *
 * <p>Every authenticated request of a session is checked here. What was read about a session is kept
 * in memory for {@code mosaikit.accounts.session-cache} (5 seconds by default), and dropped at once
 * when this kernel ends the session: the end is immediate on this kernel, and reaches the other
 * kernels of an installation within that time. The time a session was last seen is written at most
 * once a minute.
 *
 * <p>Session values and their digests are never logged.
 */
@ApplicationScoped
public class SessionRegistry {

    /** Attribute of the security identity: the identifier of the session of the request. */
    public static final String ATTRIBUTE = "mosaikit.session";

    /** How often the time a session was last seen is written, at most. */
    static final Duration TOUCH_EVERY = Duration.ofMinutes(1);

    /** The shortest timeout and maximum life accepted, so that a typo cannot end every session. */
    static final Duration SHORTEST = Duration.ofMinutes(1);

    /** Most sessions kept in memory; beyond, the memory is emptied and filled again. */
    static final int CACHE_LIMIT = 10_000;

    private static final Logger LOG = Logger.getLogger(SessionRegistry.class);
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int TOKEN_BYTES = 32;
    private static final int MAX_TOKEN_LENGTH = 100;

    /**
     * A session as the checks of requests see it.
     *
     * @param id identifier of the session, the one people see in their list
     * @param digest the digest that finds the session
     */
    public record Active(
            UUID id,
            String digest,
            UUID accountId,
            UUID organizationId,
            String kind,
            Instant lastSeen,
            Instant expiresAt,
            boolean ended) {

        static Active of(AccountSession session, String digest) {
            return new Active(
                    session.getId(),
                    digest,
                    session.getAccountId(),
                    session.getOrganizationId().orElse(null),
                    session.getKind(),
                    session.getLastSeenAt(),
                    session.getExpiresAt(),
                    session.getEndedAt().isPresent());
        }
    }

    /**
     * A session just opened with a password.
     *
     * @param id identifier of the session
     * @param token the value of its cookie, which the kernel keeps only as a digest
     */
    public record Opened(UUID id, String token) {

        @Override
        public String toString() {
            return "Opened[id=" + id + "]";
        }
    }

    private record Cached(Active active, Instant readAt) {}

    private final SessionStore store;
    private final Clock clock;
    private final Duration timeout;
    private final Duration maxLife;
    private final Duration cacheFor;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();
    /** Counts the ends, so that a session read before an end is not put in memory after it. */
    private final AtomicLong ends = new AtomicLong();

    @Inject
    public SessionRegistry(SessionStore store, KernelConfig config, Clock clock) {
        this(
                store,
                clock,
                config.accounts().sessionTimeout(),
                config.accounts().sessionMaxLife(),
                config.accounts().sessionCache());
    }

    SessionRegistry(SessionStore store, Clock clock, Duration timeout, Duration maxLife, Duration cacheFor) {
        this.store = store;
        this.clock = clock;
        this.timeout = atLeast(timeout);
        this.maxLife = atLeast(maxLife);
        this.cacheFor = cacheFor.isNegative() ? Duration.ZERO : cacheFor;
    }

    private static Duration atLeast(Duration duration) {
        return duration.compareTo(SHORTEST) < 0 ? SHORTEST : duration;
    }

    /** Opens a session of the shell with a password, for the cookie of the response. */
    public Opened open(UUID accountId, UUID organizationId, SessionClient client) {
        Instant now = Instant.now(clock);
        byte[] random = new byte[TOKEN_BYTES];
        RANDOM.nextBytes(random);
        String token = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        var session = new AccountSession(
                accountId,
                organizationId,
                RememberMe.digest(token),
                AccountSession.PASSWORD,
                client,
                now,
                now.plus(maxLife));
        store.insert(session);
        return new Opened(session.getId(), token);
    }

    /** The live session of the value of a session cookie. */
    public Optional<Active> byCookie(String token) {
        if (token == null || token.isBlank() || token.length() > MAX_TOKEN_LENGTH) {
            return Optional.empty();
        }
        String digest = RememberMe.digest(token);
        Instant now = Instant.now(clock);
        return read(digest, now, () -> store.byDigest(digest))
                .filter(found -> AccountSession.PASSWORD.equals(found.kind()))
                .filter(found -> live(found, now));
    }

    /** The live session with an identifier, read from the database. */
    public Optional<Active> byId(UUID id) {
        Instant now = Instant.now(clock);
        return store.byId(id).map(session -> Active.of(session, null)).filter(found -> live(found, now));
    }

    /**
     * The session of the realm of an organization that a token belongs to, recorded at its first
     * request; empty when it was ended.
     *
     * @param issuer the issuer of the token
     * @param sid the {@code sid} claim of the token: the session of the realm
     */
    public Optional<Active> ofRealm(
            UUID accountId, UUID organizationId, String issuer, String sid, SessionClient client) {
        String digest = RememberMe.digest("realm\n" + issuer + "\n" + sid);
        Instant now = Instant.now(clock);
        Optional<Active> found = read(
                digest,
                now,
                () -> store.byDigest(digest).or(() -> {
                    try {
                        store.insert(new AccountSession(
                                accountId,
                                organizationId,
                                digest,
                                AccountSession.REALM,
                                client,
                                now,
                                now.plus(maxLife)));
                    } catch (RuntimeException e) {
                        // Another request of the same session recorded it first.
                        LOG.debug("A realm session was recorded by a concurrent request");
                    }
                    return store.byDigest(digest);
                }));
        if (found.isEmpty() || found.get().ended() || !found.get().accountId().equals(accountId)) {
            return Optional.empty();
        }
        Active active = found.get();
        if (!active.expiresAt().isAfter(now)) {
            // The realm keeps the session longer than the kernel keeps its record: it lives on.
            Instant expiresAt = now.plus(maxLife);
            store.renew(active.id(), now, expiresAt);
            active = new Active(
                    active.id(), digest, accountId, active.organizationId(), active.kind(), now, expiresAt, false);
            replace(active);
        }
        return Optional.of(active);
    }

    /**
     * Records that a session made a request, on the organization it acts on: written when a minute
     * passed since the last time, or when the organization changed.
     */
    public void seen(Active active, UUID organizationId) {
        Instant now = Instant.now(clock);
        boolean moved = organizationId != null && !organizationId.equals(active.organizationId());
        if (!moved && Duration.between(active.lastSeen(), now).compareTo(TOUCH_EVERY) < 0) {
            return;
        }
        store.touch(active.id(), organizationId, now);
        replace(new Active(
                active.id(),
                active.digest(),
                active.accountId(),
                moved ? organizationId : active.organizationId(),
                active.kind(),
                now,
                active.expiresAt(),
                false));
    }

    /** Ends a session, and revokes the "remember me" tokens asked in it. */
    public boolean end(UUID id) {
        Instant now = Instant.now(clock);
        boolean ended = store.end(id, now, now.plus(maxLife));
        forget(active -> active.id().equals(id));
        return ended;
    }

    /** Ends a session of an account; false when the account has no such live session. */
    public boolean endOwn(UUID accountId, UUID id) {
        Instant now = Instant.now(clock);
        boolean own = store.byId(id)
                .filter(session -> session.getAccountId().equals(accountId))
                .map(session -> Active.of(session, null))
                .filter(session -> live(session, now))
                .isPresent();
        return own && end(id);
    }

    /** Ends every session of an account, for a suspension, and revokes all its tokens. */
    public void endAllOf(UUID accountId) {
        Instant now = Instant.now(clock);
        store.endAllOf(accountId, now, now.plus(maxLife));
        forget(active -> active.accountId().equals(accountId));
    }

    /**
     * Ends the sessions of an account that act on an organization, or on none, when the account
     * leaves the organization.
     */
    public void endIn(UUID accountId, UUID organizationId) {
        Instant now = Instant.now(clock);
        store.endIn(accountId, organizationId, now, now.plus(maxLife));
        forget(active -> active.accountId().equals(accountId));
    }

    /** The live sessions of an account, the most recently seen first. */
    public List<AccountSession> liveOf(UUID accountId) {
        Instant now = Instant.now(clock);
        return store.open(accountId, now).stream()
                .filter(session -> live(Active.of(session, null), now))
                .toList();
    }

    /** Removes the records of sessions past their maximum life or idle for longer than the timeout. */
    @Scheduled(every = "15m", delayed = "1m", concurrentExecution = Scheduled.ConcurrentExecution.SKIP)
    void removeExpired() {
        Instant now = Instant.now(clock);
        int removed = store.deleteExpired(now, now.minus(timeout));
        if (removed > 0) {
            LOG.debugf("Removed %d expired sessions", removed);
        }
    }

    /** Whether a session still opens requests. */
    boolean live(Active active, Instant now) {
        if (active.ended() || !active.expiresAt().isAfter(now)) {
            return false;
        }
        // The realm decides how long its sessions last without requests.
        return AccountSession.REALM.equals(active.kind())
                || active.lastSeen().plus(timeout).isAfter(now);
    }

    private Optional<Active> read(
            String digest, Instant now, java.util.function.Supplier<Optional<AccountSession>> load) {
        Cached cached = cache.get(digest);
        if (cached != null && cached.readAt().plus(cacheFor).isAfter(now)) {
            return Optional.of(cached.active());
        }
        long generation = ends.get();
        Optional<Active> loaded = load.get().map(session -> Active.of(session, digest));
        if (loaded.isPresent() && !cacheFor.isZero()) {
            if (cache.size() >= CACHE_LIMIT) {
                cache.clear();
            }
            if (ends.get() == generation) {
                cache.put(digest, new Cached(loaded.get(), now));
            }
        } else if (loaded.isEmpty()) {
            cache.remove(digest);
        }
        return loaded;
    }

    private void replace(Active active) {
        if (active.digest() != null) {
            cache.computeIfPresent(active.digest(), (key, cached) -> new Cached(active, cached.readAt()));
        }
    }

    private void forget(Predicate<Active> which) {
        ends.incrementAndGet();
        cache.values().removeIf(cached -> which.test(cached.active()));
    }

    /** The values of the identity attribute: the session of a request, if it has one. */
    public static Optional<UUID> of(io.quarkus.security.identity.SecurityIdentity identity) {
        Object value = identity == null ? null : identity.getAttribute(ATTRIBUTE);
        return value == null ? Optional.empty() : Optional.of(UUID.fromString(Objects.toString(value)));
    }
}
