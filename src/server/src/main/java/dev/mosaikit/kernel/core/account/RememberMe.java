// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.data.KernelWrites;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;

/**
 * "Remember me" for the shell: a person who asks for it at sign-in gets a second cookie, {@value
 * #COOKIE}, that signs them in again when the session of the shell ended, for {@code
 * mosaikit.accounts.remember-for}. Its value is 32 random bytes; the database keeps only their
 * SHA-256 digest. Signing out deletes it. A token belongs to the session it was asked in (MK-125):
 * ending that session revokes it, and when the session ends by itself, the token opens a new one.
 */
@KernelWrites
@ApplicationScoped
@Transactional
public class RememberMe {

    /** The cookie with the token. */
    public static final String COOKIE = "mosaikit-remember";

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final int TOKEN_BYTES = 32;

    private final RememberTokens tokens;
    private final UserAccounts accounts;
    private final Duration duration;
    private final Clock clock;

    @Inject
    public RememberMe(RememberTokens tokens, UserAccounts accounts, KernelConfig config) {
        this(tokens, accounts, config.accounts().rememberFor(), Clock.systemUTC());
    }

    RememberMe(RememberTokens tokens, UserAccounts accounts, Duration duration, Clock clock) {
        this.tokens = tokens;
        this.accounts = accounts;
        this.duration = duration;
        this.clock = clock;
    }

    /** How long a token signs in. */
    public Duration duration() {
        return duration;
    }

    /**
     * A token signed in with "remember me", with its account and the session it belongs to.
     *
     * @param session the session of the token, or empty for a token issued before MK-125
     */
    public record Remembered(UUID tokenId, UserAccount account, Optional<UUID> session) {}

    /** A new token for an account with a password, or empty for any other account. */
    public Optional<String> issue(String username) {
        return issue(username, null);
    }

    /**
     * A new token for an account with a password, or empty for any other account.
     *
     * @param session the session the person asked for it in, revoked with it, or {@code null}
     */
    public Optional<String> issue(String username, UUID session) {
        return accounts.findByUsername(username)
                .filter(account -> account.getPasswordHash().isPresent())
                .map(account -> {
                    Instant now = Instant.now(clock);
                    tokens.deleteExpired(now);
                    byte[] random = new byte[TOKEN_BYTES];
                    RANDOM.nextBytes(random);
                    String token = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
                    tokens.insert(new RememberToken(account.getId(), session, digest(token), now, now.plus(duration)));
                    return token;
                });
    }

    /** The account a valid token signs in, with a local password. */
    public Optional<UserAccount> accountOf(String token) {
        return find(token).map(Remembered::account);
    }

    /** A valid token, of an account with a local password that is not suspended. */
    public Optional<Remembered> find(String token) {
        if (token == null || token.isBlank() || token.length() > 100) {
            return Optional.empty();
        }
        Instant now = Instant.now(clock);
        return tokens.findByTokenDigest(digest(token))
                .filter(found -> found.getExpiresAt().isAfter(now))
                .flatMap(found -> accounts.findById(found.getAccountId())
                        .filter(account -> account.getPasswordHash().isPresent())
                        .filter(UserAccount::isEmailConfirmed)
                        .filter(account -> !account.isSuspended())
                        .map(account -> new Remembered(found.getId(), account, found.getSessionId())));
    }

    /** Deletes a token, so that its cookie signs nobody in any more. */
    public void revoke(String token) {
        if (token != null && !token.isBlank()) {
            tokens.deleteByTokenDigest(digest(token));
        }
    }

    /** The SHA-256 digest of a secret, in hexadecimal: what the kernel keeps of its tokens and keys. */
    public static String digest(String token) {
        try {
            return HexFormat.of()
                    .formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is part of every Java runtime", e);
        }
    }
}
