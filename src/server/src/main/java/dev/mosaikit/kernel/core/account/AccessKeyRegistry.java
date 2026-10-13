// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Predicate;

/**
 * Personal access keys (MK-060): created by people for their scripts and clients, checked on every
 * request that presents one, revoked one by one, and with every key of a person when the person is
 * suspended or leaves the organization of the key.
 *
 * <p>As for sessions (MK-125), what was read about a key is kept in memory for {@code
 * mosaikit.accounts.session-cache} (5 seconds by default) and dropped at once when this kernel revokes
 * it: a revoked key is refused at once on this kernel, and on the other kernels of an installation
 * within that time. The time a key was last used is written, and its use audited, at most once an
 * hour: a script that polls must not fill the audit log nor queue on the lock of its chain (MK-059).
 *
 * <p>The mechanism is not tied to people: service identities (MK-124) can reuse the format, the
 * digest, the memory and the revocation with a holder of their own.
 *
 * <p>Secrets and their digests are never logged.
 */
@ApplicationScoped
public class AccessKeyRegistry {

    /** The start of every key, so that the kernel and people tell a key from other tokens. */
    public static final String KEY_START = "mk_";

    /** Attribute of the security identity: the identifier of the key of the request. */
    public static final String ATTRIBUTE = "mosaikit.access-key";

    /** Attribute of the security identity: the prefix of the key of the request. */
    public static final String PREFIX_ATTRIBUTE = "mosaikit.access-key.prefix";

    /** Attribute of the security identity: {@code true} when the key of the request may write. */
    public static final String WRITE_ATTRIBUTE = "mosaikit.access-key.write";

    /** How often the time a key was last used is written, and its use audited, at most. */
    static final Duration TOUCH_EVERY = Duration.ofHours(1);

    /** Most keys kept in memory; beyond, the memory is emptied and filled again. */
    static final int CACHE_LIMIT = 10_000;

    /** Characters of a key shown in lists: its start and eight random characters. */
    static final int PREFIX_LENGTH = KEY_START.length() + 8;

    static final int MAX_NAME_LENGTH = 100;

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int TOKEN_BYTES = 32;
    private static final int MAX_TOKEN_LENGTH = 100;

    /**
     * A key as the checks of requests see it.
     *
     * @param digest the digest that finds the key
     */
    public record Active(
            UUID id,
            String digest,
            UUID accountId,
            UUID organizationId,
            String name,
            String prefix,
            boolean canWrite,
            Instant expiresAt,
            Instant lastUsed,
            boolean revoked) {

        static Active of(AccessKey key, String digest) {
            return new Active(
                    key.getId(),
                    digest,
                    key.getAccountId(),
                    key.getOrganizationId(),
                    key.getName(),
                    key.getPrefix(),
                    key.canWrite(),
                    key.getExpiresAt(),
                    key.getLastUsedAt().orElse(null),
                    key.getRevokedAt().isPresent());
        }

        /** Whether the key still opens requests. */
        public boolean live(Instant now) {
            return !revoked && expiresAt.isAfter(now);
        }

        Active usedAt(Instant now) {
            return new Active(id, digest, accountId, organizationId, name, prefix, canWrite, expiresAt, now, revoked);
        }
    }

    /**
     * A key just created.
     *
     * @param secret the whole key, shown once and kept by the kernel only as a digest
     */
    public record Created(AccessKey key, String secret) {

        @Override
        public String toString() {
            return "Created[id=" + key.getId() + "]";
        }
    }

    private record Cached(Active active, Instant readAt) {}

    private final AccessKeyStore store;
    private final Clock clock;
    private final Duration maxValidity;
    private final Duration cacheFor;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();
    /** Counts the revocations, so that a key read before one is not put in memory after it. */
    private final AtomicLong revocations = new AtomicLong();

    @Inject
    public AccessKeyRegistry(AccessKeyStore store, KernelConfig config, Clock clock) {
        this(
                store,
                clock,
                config.accounts().accessKeyMaxValidity(),
                config.accounts().sessionCache());
    }

    AccessKeyRegistry(AccessKeyStore store, Clock clock, Duration maxValidity, Duration cacheFor) {
        this.store = store;
        this.clock = clock;
        this.maxValidity = maxValidity;
        this.cacheFor = cacheFor.isNegative() ? Duration.ZERO : cacheFor;
    }

    /** The longest a key may last, from its creation. */
    public Duration maxValidity() {
        return maxValidity;
    }

    /**
     * Creates a key; the caller has checked that the person is a member of the organization.
     *
     * @param expiresAt when the key stops working, at most {@link #maxValidity()} from now; {@code
     *     null} for that longest time
     * @throws InvalidInputException when the name is missing or the expiry is not allowed
     */
    public Created create(UUID accountId, UUID organizationId, String name, Instant expiresAt, boolean canWrite) {
        Instant now = Instant.now(clock);
        String trimmed = name == null ? "" : name.strip();
        if (trimmed.isEmpty() || trimmed.length() > MAX_NAME_LENGTH) {
            throw new InvalidInputException(List.of("name is required, in at most " + MAX_NAME_LENGTH + " characters"));
        }
        Instant latest = now.plus(maxValidity);
        Instant until = expiresAt == null ? latest : expiresAt;
        if (!until.isAfter(now)) {
            throw new InvalidInputException(List.of("expiresAt must be in the future"));
        }
        if (until.isAfter(latest)) {
            throw new InvalidInputException(List.of("expiresAt must be within " + Math.max(1, maxValidity.toDays())
                    + " days, the longest a key lasts on this installation"));
        }
        byte[] random = new byte[TOKEN_BYTES];
        RANDOM.nextBytes(random);
        String secret = KEY_START + Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        var key = new AccessKey(
                accountId,
                organizationId,
                trimmed,
                secret.substring(0, PREFIX_LENGTH),
                RememberMe.digest(secret),
                canWrite,
                now,
                until);
        store.insert(key);
        return new Created(key, secret);
    }

    /** Whether a bearer token looks like a key, so that no other mechanism should read it. */
    public static boolean looksLikeKey(String token) {
        return token != null && token.startsWith(KEY_START);
    }

    /** The key of a secret, live or not; empty when no key has this secret. */
    public Optional<Active> find(String secret) {
        if (!looksLikeKey(secret) || secret.length() > MAX_TOKEN_LENGTH) {
            return Optional.empty();
        }
        String digest = RememberMe.digest(secret);
        Instant now = Instant.now(clock);
        Cached cached = cache.get(digest);
        if (cached != null && cached.readAt().plus(cacheFor).isAfter(now)) {
            return Optional.of(cached.active());
        }
        long generation = revocations.get();
        Optional<Active> loaded = store.byDigest(digest).map(key -> Active.of(key, digest));
        if (loaded.isPresent() && !cacheFor.isZero() && revocations.get() == generation) {
            if (cache.size() >= CACHE_LIMIT) {
                cache.clear();
            }
            cache.put(digest, new Cached(loaded.get(), now));
        } else if (loaded.isEmpty()) {
            cache.remove(digest);
        }
        return loaded;
    }

    /**
     * Records that a key was used: written when an hour passed since the last time.
     *
     * @return whether the use was written, and is to be audited
     */
    public boolean used(Active active) {
        Instant now = Instant.now(clock);
        if (active.lastUsed() != null
                && Duration.between(active.lastUsed(), now).compareTo(TOUCH_EVERY) < 0) {
            return false;
        }
        store.touch(active.id(), now);
        cache.computeIfPresent(active.digest(), (digest, cached) -> new Cached(active.usedAt(now), cached.readAt()));
        return true;
    }

    /** A key, live or not. */
    public Optional<AccessKey> byId(UUID id) {
        return store.byId(id);
    }

    /** The keys of an account that are not revoked, expired ones included, the newest first. */
    public List<AccessKey> of(UUID accountId) {
        return store.notRevoked(accountId);
    }

    /** Revokes a key of an account; empty when the account has no such key, or it was revoked. */
    public Optional<AccessKey> revokeOwn(UUID accountId, UUID id) {
        Optional<AccessKey> own = store.byId(id)
                .filter(key -> key.getAccountId().equals(accountId))
                .filter(key -> key.getRevokedAt().isEmpty());
        own.ifPresent(key -> {
            store.revoke(id, Instant.now(clock));
            forget(active -> active.id().equals(id));
        });
        return own;
    }

    /** Revokes every key of an account, for a suspension; returns the keys it revoked. */
    public List<AccessKey> revokeAllOf(UUID accountId) {
        List<AccessKey> revoked = store.notRevoked(accountId);
        store.revokeAllOf(accountId, Instant.now(clock));
        forget(active -> active.accountId().equals(accountId));
        return revoked;
    }

    /**
     * Revokes the keys of an account in an organization, when the account leaves it; returns the keys
     * it revoked.
     */
    public List<AccessKey> revokeIn(UUID accountId, UUID organizationId) {
        List<AccessKey> revoked = store.notRevoked(accountId).stream()
                .filter(key -> key.getOrganizationId().equals(organizationId))
                .toList();
        store.revokeIn(accountId, organizationId, Instant.now(clock));
        forget(active ->
                active.accountId().equals(accountId) && active.organizationId().equals(organizationId));
        return revoked;
    }

    private void forget(Predicate<Active> which) {
        revocations.incrementAndGet();
        cache.values().removeIf(cached -> which.test(cached.active()));
    }
}
