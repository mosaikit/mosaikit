// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.security;

import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.Objects;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

/**
 * Hashes and verifies local passwords with PBKDF2-HMAC-SHA256, using only the JDK.
 *
 * <p>The encoded form is {@code pbkdf2-sha256$<iterations>$<salt>$<hash>} with Base64 salt and
 * hash, so that the cost can be raised later without invalidating stored passwords. The default
 * cost follows the OWASP password storage recommendation for PBKDF2-HMAC-SHA256.
 */
public final class PasswordHasher {

    /** Default number of iterations. */
    public static final int DEFAULT_ITERATIONS = 600_000;

    private static final String ALGORITHM = "PBKDF2WithHmacSHA256";
    private static final String PREFIX = "pbkdf2-sha256";
    private static final int SALT_BYTES = 16;
    private static final int KEY_BITS = 256;

    private final int iterations;
    private final SecureRandom random;

    public PasswordHasher() {
        this(DEFAULT_ITERATIONS, new SecureRandom());
    }

    PasswordHasher(int iterations, SecureRandom random) {
        if (iterations < 1) {
            throw new IllegalArgumentException("iterations must be positive");
        }
        this.iterations = iterations;
        this.random = Objects.requireNonNull(random, "random");
    }

    /** Returns the encoded hash of a password, with a fresh random salt. */
    public String hash(char[] password) {
        byte[] salt = new byte[SALT_BYTES];
        random.nextBytes(salt);
        byte[] hash = derive(password, salt, iterations);
        Base64.Encoder encoder = Base64.getEncoder().withoutPadding();
        return String.join(
                "$", PREFIX, Integer.toString(iterations), encoder.encodeToString(salt), encoder.encodeToString(hash));
    }

    /** Checks a password against an encoded hash, in constant time for hashes of equal length. */
    public boolean verify(char[] password, String encoded) {
        String[] parts = encoded == null ? new String[0] : encoded.split("\\$");
        if (parts.length != 4 || !PREFIX.equals(parts[0])) {
            return false;
        }
        try {
            int cost = Integer.parseInt(parts[1]);
            Base64.Decoder decoder = Base64.getDecoder();
            byte[] salt = decoder.decode(parts[2]);
            byte[] expected = decoder.decode(parts[3]);
            return cost > 0 && MessageDigest.isEqual(expected, derive(password, salt, cost));
        } catch (IllegalArgumentException _) {
            return false;
        }
    }

    /** Burns the same time as a verification, to avoid revealing which usernames exist. */
    public void simulateVerification(char[] password) {
        derive(password, new byte[SALT_BYTES], iterations);
    }

    private static byte[] derive(char[] password, byte[] salt, int cost) {
        var spec = new PBEKeySpec(password, salt, cost, KEY_BITS);
        try {
            return SecretKeyFactory.getInstance(ALGORITHM).generateSecret(spec).getEncoded();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("PBKDF2 is not available in this JVM", e);
        } finally {
            spec.clearPassword();
        }
    }
}
