// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.service;

import dev.mosaikit.kernel.core.account.RememberMe;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Predicate;
import java.util.regex.Pattern;

/**
 * Service identities (MK-124): created by platform administrators for the internal callers of the
 * APIs of extensions, each with at most {@value #MAX_LIVE_KEYS} live keys, so that a key is rotated
 * without a pause, and with the APIs and the endpoints it may call.
 *
 * <p>As for personal access keys (MK-060), what was read about a key is kept in memory for {@code
 * mosaikit.accounts.session-cache} (5 seconds by default) and dropped at once when this kernel revokes
 * it or changes the grants of its identity: on the other kernels of an installation, within that time.
 * The time a key was last used is written at most once an hour, and the use of each API by an identity
 * is audited at most once an hour on each kernel.
 *
 * <p>Secrets and their digests are never logged.
 */
@ApplicationScoped
public class ServiceRegistry {

    /** The start of every key of a service, which tells it from a personal key ({@code mk_}). */
    public static final String KEY_START = "mks_";

    /** Attribute of the security identity: the identifier of the service identity of the request. */
    public static final String ATTRIBUTE = "mosaikit.service";

    /** Attribute of the security identity: the name of the service identity of the request. */
    public static final String NAME_ATTRIBUTE = "mosaikit.service.name";

    /** Attribute of the security identity: the identifier of the key of the request. */
    public static final String KEY_ATTRIBUTE = "mosaikit.service.key";

    /** Attribute of the security identity: the prefix of the key of the request. */
    public static final String PREFIX_ATTRIBUTE = "mosaikit.service.prefix";

    /**
     * Attribute of the security identity: an organization the request named with {@code
     * X-Mosaikit-Organization} that the identity may not name; the request is then refused.
     */
    public static final String REFUSED_ORGANIZATION_ATTRIBUTE = "mosaikit.service.refused-organization";

    /** The endpoint that checks the session cookie of a person ({@code POST /api/v1/services/check}). */
    public static final String CHECK_SESSION = "check-session";

    /** The endpoint that checks a personal access key ({@code POST /api/v1/services/check}). */
    public static final String CHECK_KEY = "check-key";

    /** The endpoints of the kernel meant for services. */
    public static final Set<String> ENDPOINTS = Set.of(CHECK_SESSION, CHECK_KEY);

    /** Live keys an identity may have: the current one and the next, while it is rotated. */
    public static final int MAX_LIVE_KEYS = 2;

    /** How often the time a key was last used is written, and a use audited, at most. */
    static final Duration TOUCH_EVERY = Duration.ofHours(1);

    /** Most entries kept in memory; beyond, the memory is emptied and filled again. */
    static final int CACHE_LIMIT = 10_000;

    /** Characters of a key shown in lists: its start and eight random characters. */
    static final int PREFIX_LENGTH = KEY_START.length() + 8;

    static final int MAX_NAME_LENGTH = 100;
    static final int MAX_DESCRIPTION_LENGTH = 500;

    /** The names of the APIs of extensions, as in {@code /api/v1/ext/<api>/}. */
    static final Pattern API_PATTERN = Pattern.compile("^[a-z0-9][a-z0-9-]{0,62}$");

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int TOKEN_BYTES = 32;
    private static final int MAX_TOKEN_LENGTH = 100;

    /**
     * A key and its identity as the checks of requests see them.
     *
     * @param digest the digest that finds the key
     */
    public record Active(
            UUID keyId,
            String digest,
            UUID serviceId,
            String name,
            String prefix,
            ServiceIdentity.Grants grants,
            Instant lastUsed,
            boolean revoked) {

        static Active of(ServiceStore.Loaded loaded, String digest) {
            ServiceKey key = loaded.key();
            return new Active(
                    key.getId(),
                    digest,
                    key.getServiceId(),
                    loaded.identity().getName(),
                    key.getPrefix(),
                    loaded.identity().grants(),
                    key.getLastUsedAt().orElse(null),
                    key.getRevokedAt().isPresent());
        }

        Active usedAt(Instant now) {
            return new Active(keyId, digest, serviceId, name, prefix, grants, now, revoked);
        }
    }

    /**
     * A key just created, with its identity.
     *
     * @param secret the whole key, shown once and kept by the kernel only as a digest
     */
    public record Created(ServiceIdentity identity, ServiceKey key, String secret) {

        @Override
        public String toString() {
            return "Created[identity=" + identity.getId() + ", key=" + key.getId() + "]";
        }
    }

    private record Cached(Active active, Instant readAt) {}

    private final ServiceStore store;
    private final Clock clock;
    private final Duration cacheFor;
    private final Map<String, Cached> cache = new ConcurrentHashMap<>();
    /** When each identity last had each API audited as used, on this kernel. */
    private final Map<String, Instant> audited = new ConcurrentHashMap<>();
    /** Counts the revocations and changes, so that a key read before one is not put in memory after it. */
    private final AtomicLong changes = new AtomicLong();

    @Inject
    public ServiceRegistry(ServiceStore store, KernelConfig config, Clock clock) {
        this(store, clock, config.accounts().sessionCache());
    }

    ServiceRegistry(ServiceStore store, Clock clock, Duration cacheFor) {
        this.store = store;
        this.clock = clock;
        this.cacheFor = cacheFor.isNegative() ? Duration.ZERO : cacheFor;
    }

    /** Whether a bearer token looks like the key of a service, so that no other mechanism reads it. */
    public static boolean looksLikeKey(String token) {
        return token != null && token.startsWith(KEY_START);
    }

    /**
     * Creates a service identity and its first key.
     *
     * @throws InvalidInputException when the name or a grant is not valid
     * @throws ConflictException when another identity has the name
     */
    public Created create(String name, String description, ServiceIdentity.Grants grants, String createdBy) {
        String trimmed = name == null ? "" : name.strip();
        List<String> problems = new ArrayList<>();
        if (trimmed.isEmpty() || trimmed.length() > MAX_NAME_LENGTH) {
            problems.add("name is required, in at most " + MAX_NAME_LENGTH + " characters");
        }
        problems.addAll(check(description, grants));
        if (!problems.isEmpty()) {
            throw new InvalidInputException(problems);
        }
        if (store.byName(trimmed).isPresent()) {
            throw new ConflictException("A service identity is already called " + trimmed + ".");
        }
        Instant now = Instant.now(clock);
        var identity = new ServiceIdentity(trimmed, description(description), grants, now, createdBy);
        String secret = secret();
        ServiceKey key = key(identity.getId(), secret, now);
        store.insert(identity, key);
        return new Created(identity, key, secret);
    }

    /**
     * Gives an identity a new key, to rotate the one it has: the old one goes on until it is revoked.
     *
     * @throws ResourceNotFoundException when there is no such identity
     * @throws ConflictException when the identity already has {@value #MAX_LIVE_KEYS} live keys
     */
    public Created newKey(UUID serviceId) {
        ServiceIdentity identity = identity(serviceId);
        if (store.liveKeysOf(serviceId).size() >= MAX_LIVE_KEYS) {
            throw new ConflictException("This service identity already has " + MAX_LIVE_KEYS
                    + " live keys: revoke the old one before creating another.");
        }
        String secret = secret();
        ServiceKey key = key(serviceId, secret, Instant.now(clock));
        store.insert(key);
        return new Created(identity, key, secret);
    }

    /**
     * Changes the description and what an identity may call and name; the requests of its keys follow
     * at once on this kernel.
     */
    public ServiceIdentity grant(UUID serviceId, String description, ServiceIdentity.Grants grants) {
        ServiceIdentity identity = identity(serviceId);
        List<String> problems = check(description, grants);
        if (grants == null || !problems.isEmpty()) {
            throw new InvalidInputException(problems);
        }
        store.grant(identity, description(description), grants);
        forget(active -> active.serviceId().equals(serviceId));
        return identity(serviceId);
    }

    /** Revokes a key of an identity; empty when the identity has no such live key. */
    public Optional<ServiceKey> revoke(UUID serviceId, UUID keyId) {
        Optional<ServiceKey> live = store.liveKeysOf(serviceId).stream()
                .filter(key -> key.getId().equals(keyId))
                .findFirst();
        live.ifPresent(key -> {
            store.revoke(serviceId, keyId, Instant.now(clock));
            forget(active -> active.keyId().equals(keyId));
        });
        return live;
    }

    /** Every service identity, by name. */
    public List<ServiceIdentity> identities() {
        return store.all();
    }

    /** The live keys of every identity, the newest first. */
    public List<ServiceKey> liveKeys() {
        return store.liveKeys();
    }

    /** The live keys of an identity, the newest first. */
    public List<ServiceKey> liveKeysOf(UUID serviceId) {
        return store.liveKeysOf(serviceId);
    }

    /** An identity. */
    public ServiceIdentity identity(UUID serviceId) {
        return store.byId(serviceId)
                .orElseThrow(() -> new ResourceNotFoundException("No service identity with this identifier."));
    }

    /** The key of a secret, live or not, with its identity; empty when no key has this secret. */
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
        long generation = changes.get();
        Optional<Active> loaded = store.byDigest(digest).map(found -> Active.of(found, digest));
        if (loaded.isPresent() && !cacheFor.isZero() && changes.get() == generation) {
            if (cache.size() >= CACHE_LIMIT) {
                cache.clear();
            }
            cache.put(digest, new Cached(loaded.get(), now));
        } else if (loaded.isEmpty()) {
            cache.remove(digest);
        }
        return loaded;
    }

    /** Records that a key was used: written when an hour passed since the last time. */
    public void used(Active active) {
        Instant now = Instant.now(clock);
        if (active.lastUsed() != null
                && Duration.between(active.lastUsed(), now).compareTo(TOUCH_EVERY) < 0) {
            return;
        }
        store.touch(active.keyId(), now);
        cache.computeIfPresent(active.digest(), (digest, cached) -> new Cached(active.usedAt(now), cached.readAt()));
    }

    /**
     * Whether a use of an API by an identity is the first in an hour on this kernel, and is to be
     * audited.
     *
     * @param target the name of the API, or of the endpoint of the kernel
     */
    public boolean firstUseThisHour(UUID serviceId, String target) {
        Instant now = Instant.now(clock);
        if (audited.size() >= CACHE_LIMIT) {
            audited.clear();
        }
        boolean[] first = {false};
        audited.compute(serviceId + " " + target, (key, last) -> {
            if (last != null && Duration.between(last, now).compareTo(TOUCH_EVERY) < 0) {
                return last;
            }
            first[0] = true;
            return now;
        });
        return first[0];
    }

    private static List<String> check(String description, ServiceIdentity.Grants grants) {
        List<String> problems = new ArrayList<>();
        if (description != null && description.strip().length() > MAX_DESCRIPTION_LENGTH) {
            problems.add("description must be at most " + MAX_DESCRIPTION_LENGTH + " characters");
        }
        if (grants == null) {
            problems.add("apis is required");
            return problems;
        }
        grants.apis().stream()
                .filter(api -> !API_PATTERN.matcher(api).matches())
                .sorted()
                .forEach(api -> problems.add("apis: " + api + " is not the name of an API of extensions"));
        grants.endpoints().stream()
                .filter(endpoint -> !ENDPOINTS.contains(endpoint))
                .sorted()
                .forEach(endpoint -> problems.add("endpoints: " + endpoint + " is not one of "
                        + ENDPOINTS.stream().sorted().toList()));
        return problems;
    }

    private static String description(String description) {
        return description == null ? "" : description.strip();
    }

    private static String secret() {
        byte[] random = new byte[TOKEN_BYTES];
        RANDOM.nextBytes(random);
        return KEY_START + Base64.getUrlEncoder().withoutPadding().encodeToString(random);
    }

    private static ServiceKey key(UUID serviceId, String secret, Instant now) {
        return new ServiceKey(serviceId, secret.substring(0, PREFIX_LENGTH), RememberMe.digest(secret), now);
    }

    private void forget(Predicate<Active> which) {
        changes.incrementAndGet();
        cache.values().removeIf(cached -> which.test(cached.active()));
    }
}
