// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import dev.mosaikit.kernel.core.secrets.SecretKeys.MasterKey;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * Envelope encryption of credentials (MK-062). Each value is encrypted with AES-256-GCM under a
 * random data key of its own and a random nonce; the data key is encrypted, the same way, under a
 * master key that stays out of the database. Both encryptions take as associated data the
 * organization and the name of the credential, so a ciphertext copied to another row, of another
 * organization or under another name, does not decrypt.
 *
 * <p>A sealed field is the nonce followed by the ciphertext and its tag. Nothing here logs, and no
 * failure carries a value or a key.
 */
final class SecretCipher {

    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int NONCE_BYTES = 12;
    private static final int TAG_BITS = 128;
    private static final int DATA_KEY_BYTES = 32;
    private static final SecureRandom RANDOM = new SecureRandom();

    /** A failure to decrypt: a wrong key, a changed ciphertext, or one moved from another row. */
    static final class UnreadableException extends RuntimeException {

        private static final long serialVersionUID = 1L;

        UnreadableException() {
            super("The credential cannot be decrypted with the master keys of the installation.");
        }
    }

    /** What is stored of a value: the key that encrypts its data key, the data key and the value, sealed. */
    record Sealed(String keyId, byte[] wrappedKey, byte[] ciphertext) {

        @Override
        public String toString() {
            return "Sealed[" + keyId + "]";
        }
    }

    private SecretCipher() {}

    /** The associated data that binds a ciphertext to its organization and name. */
    static byte[] binding(UUID organization, String name) {
        return ("mosaikit.secret.v1\u0000" + organization + "\u0000" + name).getBytes(StandardCharsets.UTF_8);
    }

    /**
     * The associated data that binds a ciphertext of the installation (MK-127) to its name, in a
     * scope that no organization has: a row moved between the installation and an organization does
     * not decrypt.
     */
    static byte[] installationBinding(String name) {
        return ("mosaikit.installation-secret.v1\u0000" + name).getBytes(StandardCharsets.UTF_8);
    }

    /** Encrypts a value under a new data key, and the data key under the master key. */
    static Sealed seal(MasterKey master, byte[] binding, byte[] value) {
        byte[] dataKey = new byte[DATA_KEY_BYTES];
        RANDOM.nextBytes(dataKey);
        try {
            byte[] ciphertext = encrypt(new SecretKeySpec(dataKey, "AES"), binding, value);
            byte[] wrapped = encrypt(master.key(), binding, dataKey);
            return new Sealed(master.id(), wrapped, ciphertext);
        } finally {
            Arrays.fill(dataKey, (byte) 0);
        }
    }

    /**
     * Decrypts a value.
     *
     * @throws UnreadableException when the master key, the binding or the stored bytes do not match
     */
    static byte[] open(MasterKey master, byte[] binding, byte[] wrappedKey, byte[] ciphertext) {
        byte[] dataKey = decrypt(master.key(), binding, wrappedKey);
        try {
            return decrypt(new SecretKeySpec(dataKey, "AES"), binding, ciphertext);
        } finally {
            Arrays.fill(dataKey, (byte) 0);
        }
    }

    /**
     * Encrypts the data key of a value again under another master key, for a rotation; the value
     * itself is neither decrypted nor changed.
     *
     * @throws UnreadableException when the data key does not decrypt with {@code from}
     */
    static byte[] rewrap(MasterKey from, MasterKey to, byte[] binding, byte[] wrappedKey) {
        byte[] dataKey = decrypt(from.key(), binding, wrappedKey);
        try {
            return encrypt(to.key(), binding, dataKey);
        } finally {
            Arrays.fill(dataKey, (byte) 0);
        }
    }

    private static byte[] encrypt(SecretKey key, byte[] binding, byte[] plain) {
        byte[] nonce = new byte[NONCE_BYTES];
        RANDOM.nextBytes(nonce);
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, nonce));
            cipher.updateAAD(binding);
            byte[] sealed = cipher.doFinal(plain);
            return ByteBuffer.allocate(NONCE_BYTES + sealed.length)
                    .put(nonce)
                    .put(sealed)
                    .array();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException(
                    "AES-GCM is not available: " + e.getClass().getSimpleName());
        }
    }

    private static byte[] decrypt(SecretKey key, byte[] binding, byte[] sealed) {
        if (sealed == null || sealed.length < NONCE_BYTES + TAG_BITS / 8) {
            throw new UnreadableException();
        }
        try {
            Cipher cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(TAG_BITS, sealed, 0, NONCE_BYTES));
            cipher.updateAAD(binding);
            return cipher.doFinal(sealed, NONCE_BYTES, sealed.length - NONCE_BYTES);
        } catch (GeneralSecurityException _) {
            throw new UnreadableException();
        }
    }
}
