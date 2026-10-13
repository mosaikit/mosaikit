// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.secrets;

import java.nio.ByteBuffer;
import java.nio.CharBuffer;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Objects;

/**
 * The value of a credential (MK-062). Its {@code toString} masks the value, so that logging the object,
 * or an object that holds it, never writes the value; take it only where the external service needs
 * it, with {@link #chars()}, {@link #bytes()} or {@link #reveal()}. {@link #close()} overwrites the
 * value in memory; after it every accessor throws {@link IllegalStateException}.
 *
 * <p>Two values are equal only when they are the same object, so that comparing values never leaks
 * their content through timing or logs.
 */
public final class SecretValue implements AutoCloseable {

    private static final String MASKED = "SecretValue[••••]";

    private final char[] value;
    private boolean closed;

    private SecretValue(char[] value) {
        this.value = value;
    }

    /** A value made of a copy of the given characters; the caller may overwrite its array after. */
    public static SecretValue of(char[] value) {
        return new SecretValue(Objects.requireNonNull(value, "value").clone());
    }

    /**
     * A value made of the given bytes in UTF-8, decoded; the caller may overwrite its array after.
     */
    public static SecretValue ofUtf8(byte[] value) {
        CharBuffer decoded = StandardCharsets.UTF_8.decode(ByteBuffer.wrap(Objects.requireNonNull(value, "value")));
        char[] chars = new char[decoded.remaining()];
        decoded.get(chars);
        if (decoded.hasArray()) {
            Arrays.fill(decoded.array(), '\0');
        }
        return new SecretValue(chars);
    }

    /** A copy of the value as characters; overwrite it when done. */
    public synchronized char[] chars() {
        open();
        return value.clone();
    }

    /** A copy of the value in UTF-8; overwrite it when done. */
    public synchronized byte[] bytes() {
        open();
        ByteBuffer encoded = StandardCharsets.UTF_8.encode(CharBuffer.wrap(value));
        byte[] bytes = new byte[encoded.remaining()];
        encoded.get(bytes);
        if (encoded.hasArray()) {
            Arrays.fill(encoded.array(), (byte) 0);
        }
        return bytes;
    }

    /**
     * The value as a string, for the APIs that take only strings, such as an HTTP header. A string
     * cannot be overwritten: prefer {@link #chars()} or {@link #bytes()} when the API takes them.
     */
    public synchronized String reveal() {
        open();
        return new String(value);
    }

    /** How many characters the value has. */
    public synchronized int length() {
        open();
        return value.length;
    }

    /** Overwrites the value in memory. Closing twice does nothing. */
    @Override
    public synchronized void close() {
        Arrays.fill(value, '\0');
        closed = true;
    }

    private void open() {
        if (closed) {
            throw new IllegalStateException("The value of the credential was closed.");
        }
    }

    /** Never the value. */
    @Override
    public String toString() {
        return MASKED;
    }
}
