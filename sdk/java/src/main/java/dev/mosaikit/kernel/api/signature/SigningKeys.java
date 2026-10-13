// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.signature;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.GeneralSecurityException;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.stream.Stream;

/**
 * Ed25519 keys of extension publishers, stored as PEM files: {@code <name>.pub.pem} (public, to give
 * to installations) and {@code <name>.key.pem} (private, to keep secret).
 */
public final class SigningKeys {

    /** Signature algorithm of packages. */
    public static final String ALGORITHM = "Ed25519";

    /** Suffix of public key files, as found in a trusted keys directory. */
    public static final String PUBLIC_SUFFIX = ".pub.pem";

    /** Suffix of private key files. */
    public static final String PRIVATE_SUFFIX = ".key.pem";

    private static final String PUBLIC_LABEL = "PUBLIC KEY";
    private static final String PRIVATE_LABEL = "PRIVATE KEY";

    private SigningKeys() {}

    /** Generates a new key pair. */
    public static KeyPair generate() {
        try {
            return KeyPairGenerator.getInstance(ALGORITHM).generateKeyPair();
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("Ed25519 is part of every Java platform", e);
        }
    }

    /**
     * Short identifier of a public key: the first 16 hexadecimal digits of the SHA-256 of its
     * encoded form, so that two different keys never look alike.
     */
    public static String keyId(PublicKey key) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(key.getEncoded());
            return HexFormat.of().formatHex(digest, 0, 8);
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("SHA-256 is part of every Java platform", e);
        }
    }

    /** Writes {@code <name>.pub.pem} and {@code <name>.key.pem}; the private key is readable by the owner only. */
    public static void write(KeyPair pair, Path directory, String name) throws IOException {
        Files.createDirectories(directory);
        Files.writeString(
                directory.resolve(name + PUBLIC_SUFFIX),
                pem(PUBLIC_LABEL, pair.getPublic().getEncoded()));
        Path privateFile = directory.resolve(name + PRIVATE_SUFFIX);
        Files.writeString(privateFile, pem(PRIVATE_LABEL, pair.getPrivate().getEncoded()));
        if (privateFile.getFileSystem().supportedFileAttributeViews().contains("posix")) {
            Files.setPosixFilePermissions(privateFile, PosixFilePermissions.fromString("rw-------"));
        }
    }

    /** Reads a public key from a PEM file. */
    public static PublicKey readPublic(Path file) throws IOException {
        try {
            return KeyFactory.getInstance(ALGORITHM)
                    .generatePublic(new X509EncodedKeySpec(decode(Files.readString(file), PUBLIC_LABEL, file)));
        } catch (GeneralSecurityException e) {
            throw new IOException("Not an Ed25519 public key: " + file, e);
        }
    }

    /** Reads a private key from a PEM file. */
    public static PrivateKey readPrivate(Path file) throws IOException {
        try {
            return KeyFactory.getInstance(ALGORITHM)
                    .generatePrivate(new PKCS8EncodedKeySpec(decode(Files.readString(file), PRIVATE_LABEL, file)));
        } catch (GeneralSecurityException e) {
            throw new IOException("Not an Ed25519 private key: " + file, e);
        }
    }

    /**
     * Reads the public keys of a directory ({@code *.pub.pem}), by key identifier. A missing
     * directory trusts no key.
     */
    public static Map<String, PublicKey> readTrusted(Path directory) throws IOException {
        Map<String, PublicKey> keys = new LinkedHashMap<>();
        if (!Files.isDirectory(directory)) {
            return keys;
        }
        try (Stream<Path> files = Files.list(directory)) {
            for (Path file : files.sorted().toList()) {
                if (file.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(PUBLIC_SUFFIX)) {
                    PublicKey key = readPublic(file);
                    keys.put(keyId(key), key);
                }
            }
        }
        return Map.copyOf(keys);
    }

    private static String pem(String label, byte[] encoded) {
        return "-----BEGIN " + label + "-----\n"
                + Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.US_ASCII))
                        .encodeToString(encoded)
                + "\n-----END " + label + "-----\n";
    }

    private static byte[] decode(String text, String label, Path file) throws IOException {
        String begin = "-----BEGIN " + label + "-----";
        String end = "-----END " + label + "-----";
        int start = text.indexOf(begin);
        int stop = text.indexOf(end);
        if (start < 0 || stop < start) {
            throw new IOException("No " + label + " in " + file);
        }
        try {
            return Base64.getMimeDecoder().decode(text.substring(start + begin.length(), stop));
        } catch (IllegalArgumentException e) {
            throw new IOException("Malformed " + label + " in " + file, e);
        }
    }
}
