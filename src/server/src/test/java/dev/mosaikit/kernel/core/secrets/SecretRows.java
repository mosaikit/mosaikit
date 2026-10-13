// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.secrets;

import dev.mosaikit.kernel.core.secrets.SecretKeys.MasterKey;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.UUID;

/**
 * The master keys of the tests (in {@code application.properties}) and what the kernel stores of a
 * value, for the tests that look at the rows of credentials: to check that a row decrypts, and to
 * write one under the former key as a kernel before a rotation would have.
 */
public final class SecretRows {

    /** The current master key of the tests: 32 bytes 0x11. */
    public static final byte[] CURRENT = filled(0x11);

    /** The former master key of the tests: 32 bytes 0x22. */
    public static final byte[] FORMER = filled(0x22);

    private static final SecretKeys KEYS = SecretKeys.of(CURRENT, FORMER);

    /** A sealed value as a row keeps it. */
    public record Row(String keyId, byte[] wrappedKey, byte[] ciphertext) {}

    private SecretRows() {}

    public static String currentId() {
        return SecretKeys.id(CURRENT);
    }

    public static String formerId() {
        return SecretKeys.id(FORMER);
    }

    /** Seals a value of a credential under the former key. */
    public static Row sealFormer(UUID organization, String name, String value) {
        MasterKey former = KEYS.find(formerId()).orElseThrow();
        SecretCipher.Sealed sealed = SecretCipher.seal(
                former, SecretCipher.binding(organization, name), value.getBytes(StandardCharsets.UTF_8));
        return new Row(sealed.keyId(), sealed.wrappedKey(), sealed.ciphertext());
    }

    /** The value of a row, decrypted with the key it names. */
    public static String open(UUID organization, String name, Row row) {
        MasterKey key = KEYS.find(row.keyId()).orElseThrow();
        return new String(
                SecretCipher.open(key, SecretCipher.binding(organization, name), row.wrappedKey(), row.ciphertext()),
                StandardCharsets.UTF_8);
    }

    /** Seals a value of a credential of the installation (MK-127) under the former key. */
    public static Row sealFormerOfInstallation(String name, String value) {
        MasterKey former = KEYS.find(formerId()).orElseThrow();
        SecretCipher.Sealed sealed = SecretCipher.seal(
                former, SecretCipher.installationBinding(name), value.getBytes(StandardCharsets.UTF_8));
        return new Row(sealed.keyId(), sealed.wrappedKey(), sealed.ciphertext());
    }

    /** The value of a row of the installation (MK-127), decrypted with the key it names. */
    public static String openOfInstallation(String name, Row row) {
        MasterKey key = KEYS.find(row.keyId()).orElseThrow();
        return new String(
                SecretCipher.open(key, SecretCipher.installationBinding(name), row.wrappedKey(), row.ciphertext()),
                StandardCharsets.UTF_8);
    }

    private static byte[] filled(int value) {
        byte[] bytes = new byte[SecretKeys.KEY_BYTES];
        Arrays.fill(bytes, (byte) value);
        return bytes;
    }
}
