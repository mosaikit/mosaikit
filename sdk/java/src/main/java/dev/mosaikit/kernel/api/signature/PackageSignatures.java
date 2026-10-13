// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.signature;

import java.io.IOException;
import java.io.InputStream;
import java.io.StringReader;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.security.GeneralSecurityException;
import java.security.KeyPair;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Properties;
import java.util.Set;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/**
 * Signs and verifies extension packages (MK-013).
 *
 * <p>A signed package is an ordinary package with two more entries:
 *
 * <ul>
 *   <li>{@value #DIGESTS_ENTRY}: one line {@code <sha-256>  <entry name>} for every file of the
 *       package, sorted by name;
 *   <li>{@value #SIGNATURE_ENTRY}: {@code algorithm}, {@code key} (the key identifier) and
 *       {@code signature}, the Ed25519 signature of the digests file in Base64.
 * </ul>
 *
 * <p>Verification recomputes the digests from the package, so that a file added, removed or
 * changed after signing, or entries that appear twice, make the package refused. The same zip
 * then installs identically in every distribution: portable, container and Kubernetes.
 */
public final class PackageSignatures {

    private static final String ALGORITHM_PROPERTY = "algorithm";

    /** Directory of the signature files inside a package. */
    public static final String DIRECTORY = "META-INF/mosaikit/";

    /** Digests of the files of the package. */
    public static final String DIGESTS_ENTRY = DIRECTORY + "digests.txt";

    /** Signature of the digests file. */
    public static final String SIGNATURE_ENTRY = DIRECTORY + "signature.properties";

    private PackageSignatures() {}

    /**
     * Signs a package in place, replacing a previous signature.
     *
     * @throws IOException if the package cannot be read or written
     */
    public static void sign(Path packageFile, KeyPair key) throws IOException {
        Objects.requireNonNull(key, "key");
        byte[] digests;
        try (ZipFile zip = new ZipFile(packageFile.toFile())) {
            digests = digests(zip).getBytes(StandardCharsets.UTF_8);
        } catch (PackageSignatureException e) {
            throw new IOException(e.getMessage(), e);
        }
        Properties signature = new Properties();
        signature.setProperty(ALGORITHM_PROPERTY, SigningKeys.ALGORITHM);
        signature.setProperty("key", SigningKeys.keyId(key.getPublic()));
        signature.setProperty("signature", Base64.getEncoder().encodeToString(signatureOf(key, digests)));

        Path signed = Files.createTempFile(packageFile.toAbsolutePath().getParent(), ".signing-", ".zip");
        try {
            try (ZipFile zip = new ZipFile(packageFile.toFile());
                    ZipOutputStream out = new ZipOutputStream(Files.newOutputStream(signed))) {
                var entries = zip.entries();
                while (entries.hasMoreElements()) {
                    ZipEntry entry = entries.nextElement();
                    if (entry.getName().startsWith(DIRECTORY)) {
                        continue;
                    }
                    out.putNextEntry(new ZipEntry(entry.getName()));
                    try (InputStream in = zip.getInputStream(entry)) {
                        in.transferTo(out);
                    }
                    out.closeEntry();
                }
                out.putNextEntry(new ZipEntry(DIGESTS_ENTRY));
                out.write(digests);
                out.closeEntry();
                out.putNextEntry(new ZipEntry(SIGNATURE_ENTRY));
                var text = new StringWriter();
                signature.store(text, "Signature of " + DIGESTS_ENTRY);
                out.write(text.toString().getBytes(StandardCharsets.ISO_8859_1));
                out.closeEntry();
            }
            Files.move(signed, packageFile, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            Files.deleteIfExists(signed);
        }
    }

    /**
     * Checks the signature of a package.
     *
     * @param trustedKeys the keys the installation trusts, by key identifier
     * @return whether the package is unsigned, signed with an unknown key, or verified
     * @throws PackageSignatureException if the package is signed but its content, or its
     *     signature with a trusted key, does not match
     * @throws IOException if the package cannot be read
     */
    public static PackageVerification verify(Path packageFile, Map<String, PublicKey> trustedKeys)
            throws IOException, PackageSignatureException {
        try (ZipFile zip = new ZipFile(packageFile.toFile())) {
            ZipEntry digestsEntry = zip.getEntry(DIGESTS_ENTRY);
            ZipEntry signatureEntry = zip.getEntry(SIGNATURE_ENTRY);
            String computed = digests(zip);
            if (digestsEntry == null && signatureEntry == null) {
                return new PackageVerification.Unsigned();
            }
            if (digestsEntry == null || signatureEntry == null) {
                throw new PackageSignatureException(
                        "Incomplete signature: " + DIGESTS_ENTRY + " and " + SIGNATURE_ENTRY + " must both be present");
            }
            byte[] stored = read(zip, digestsEntry);
            if (!computed.equals(new String(stored, StandardCharsets.UTF_8))) {
                throw new PackageSignatureException("The content of the package does not match its digests: "
                        + firstDifference(computed, new String(stored, StandardCharsets.UTF_8)));
            }
            Properties signature = new Properties();
            signature.load(new StringReader(new String(read(zip, signatureEntry), StandardCharsets.ISO_8859_1)));
            if (!SigningKeys.ALGORITHM.equals(signature.getProperty(ALGORITHM_PROPERTY))) {
                throw new PackageSignatureException(
                        "Unsupported signature algorithm: " + signature.getProperty(ALGORITHM_PROPERTY));
            }
            String keyId = signature.getProperty("key", "");
            PublicKey key = trustedKeys.get(keyId);
            if (key == null) {
                return new PackageVerification.UnknownKey(keyId);
            }
            if (!isValid(key, stored, signature.getProperty("signature", ""))) {
                throw new PackageSignatureException("The signature does not match the key " + keyId);
            }
            return new PackageVerification.Verified(keyId);
        }
    }

    /** The digests file of a package: every file but the signature files, sorted by name. */
    private static String digests(ZipFile zip) throws IOException, PackageSignatureException {
        TreeMap<String, String> digests = new TreeMap<>();
        Set<String> names = new HashSet<>();
        var entries = zip.entries();
        while (entries.hasMoreElements()) {
            ZipEntry entry = entries.nextElement();
            String name = entry.getName();
            if (!names.add(name)) {
                throw new PackageSignatureException("The entry " + name + " appears twice");
            }
            if (name.contains("\n") || name.contains("\r")) {
                throw new PackageSignatureException("An entry name contains a line break");
            }
            if (name.startsWith(DIRECTORY)) {
                if (!name.equals(DIGESTS_ENTRY) && !name.equals(SIGNATURE_ENTRY) && !name.equals(DIRECTORY)) {
                    throw new PackageSignatureException("Unexpected entry " + name);
                }
                continue;
            }
            if (!entry.isDirectory()) {
                try (InputStream in = zip.getInputStream(entry)) {
                    digests.put(name, sha256(in));
                }
            }
        }
        StringBuilder text = new StringBuilder();
        digests.forEach(
                (name, digest) -> text.append(digest).append("  ").append(name).append('\n'));
        return text.toString();
    }

    private static String firstDifference(String computed, String stored) {
        List<String> actual = new ArrayList<>(computed.lines().toList());
        List<String> expected = new ArrayList<>(stored.lines().toList());
        for (String line : actual) {
            if (!expected.contains(line)) {
                return "changed or added " + line.substring(line.indexOf("  ") + 2);
            }
        }
        expected.removeAll(actual);
        return expected.isEmpty()
                ? "different digests file"
                : "missing " + expected.getFirst().substring(expected.getFirst().indexOf("  ") + 2);
    }

    private static byte[] read(ZipFile zip, ZipEntry entry) throws IOException {
        try (InputStream in = zip.getInputStream(entry)) {
            return in.readNBytes(16 * 1024 * 1024);
        }
    }

    static String sha256(InputStream in) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            for (int read = in.read(buffer); read >= 0; read = in.read(buffer)) {
                digest.update(buffer, 0, read);
            }
            return HexFormat.of().formatHex(digest.digest());
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("SHA-256 is part of every Java platform", e);
        }
    }

    static byte[] signatureOf(KeyPair key, byte[] content) {
        try {
            Signature signer = Signature.getInstance(SigningKeys.ALGORITHM);
            signer.initSign(key.getPrivate());
            signer.update(content);
            return signer.sign();
        } catch (GeneralSecurityException e) {
            throw new IllegalArgumentException("Not an Ed25519 key pair", e);
        }
    }

    static boolean isValid(PublicKey key, byte[] content, String signature) {
        try {
            Signature verifier = Signature.getInstance(SigningKeys.ALGORITHM);
            verifier.initVerify(key);
            verifier.update(content);
            return verifier.verify(Base64.getDecoder().decode(signature));
        } catch (GeneralSecurityException | IllegalArgumentException _) {
            return false;
        }
    }
}
