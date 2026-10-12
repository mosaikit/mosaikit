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
import java.security.KeyPair;
import java.security.PublicKey;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Properties;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * The signed index of a directory of extension packages, the catalog of a marketplace (MK-022): {@code
 * index.json} lists each package with its identity and SHA-256, and {@code index.json.sig} signs it
 * with the Ed25519 key of the publisher of the catalog. The kernel downloads only packages whose
 * hash matches a verified index, and still checks the signature of each package.
 */
public final class ExtensionIndex {

    /** Name of the index in a catalog directory. */
    public static final String INDEX_FILE = "index.json";

    /** Name of its signature. */
    public static final String SIGNATURE_FILE = "index.json.sig";

    /** Version of the format of the index. */
    public static final int FORMAT = 1;

    /** A top-level key of the manifest; the value is stripped in code, not by the expression. */
    private static final Pattern TOP_LEVEL = Pattern.compile("^(id|version|name):(.*)$");

    private static final String ALGORITHM_PROPERTY = "algorithm";

    private ExtensionIndex() {}

    /**
     * A package in the index.
     *
     * @param id identifier of the extension
     * @param version version of the extension
     * @param name human readable name
     * @param file name of the package, relative to the index
     * @param sha256 hex SHA-256 of the package
     * @param size size of the package in bytes
     * @param publisherKey the key that signed the package, empty when it is not signed
     */
    public record Entry(
            String id, String version, String name, String file, String sha256, long size, String publisherKey) {

        public Entry {
            Objects.requireNonNull(id, "id");
            Objects.requireNonNull(version, "version");
            Objects.requireNonNull(file, "file");
            Objects.requireNonNull(sha256, "sha256");
            name = Objects.requireNonNullElse(name, id);
            publisherKey = Objects.requireNonNullElse(publisherKey, "");
        }
    }

    /**
     * Writes and signs the index of every package of a directory.
     *
     * @return the entries of the index
     * @throws IOException if a package or the directory cannot be read or written
     */
    public static List<Entry> write(Path directory, KeyPair key, Instant generated) throws IOException {
        List<Entry> entries = new ArrayList<>();
        try (Stream<Path> files = Files.list(directory)) {
            for (Path file : files.filter(ExtensionIndex::isPackage).sorted().toList()) {
                entries.add(describe(file));
            }
        }
        byte[] index = toJson(entries, generated).getBytes(StandardCharsets.UTF_8);
        Files.write(directory.resolve(INDEX_FILE), index);
        Files.write(directory.resolve(SIGNATURE_FILE), signature(index, key));
        return entries;
    }

    /** The entry of a package, from its manifest and its bytes. */
    public static Entry describe(Path packageFile) throws IOException {
        Map<String, String> identity = identity(packageFile);
        String id = identity.get("id");
        String version = identity.get("version");
        if (id == null || version == null) {
            throw new IOException(packageFile + " has no manifest.yaml with an id and a version");
        }
        String sha256;
        try (InputStream in = Files.newInputStream(packageFile)) {
            sha256 = PackageSignatures.sha256(in);
        }
        String publisher;
        try {
            publisher = switch (PackageSignatures.verify(packageFile, Map.of())) {
                case PackageVerification.UnknownKey(String keyId) -> keyId;
                case PackageVerification.Verified(String keyId) -> keyId;
                case PackageVerification.Unsigned() -> "";
            };
        } catch (PackageSignatureException e) {
            throw new IOException(packageFile + ": " + e.getMessage(), e);
        }
        return new Entry(
                id,
                version,
                identity.get("name"),
                packageFile.getFileName().toString(),
                sha256,
                Files.size(packageFile),
                publisher);
    }

    /**
     * Checks the signature of an index.
     *
     * @return the identifier of the trusted key that signed it
     * @throws PackageSignatureException when the index is not signed by a trusted key
     */
    public static String verify(byte[] index, byte[] signature, Map<String, PublicKey> trustedKeys)
            throws PackageSignatureException {
        Properties properties = new Properties();
        try {
            properties.load(new StringReader(new String(signature, StandardCharsets.ISO_8859_1)));
        } catch (IOException | IllegalArgumentException _) {
            // Properties refuses a malformed unicode escape with IllegalArgumentException.
            throw new PackageSignatureException("Unreadable signature of the index");
        }
        if (!SigningKeys.ALGORITHM.equals(properties.getProperty(ALGORITHM_PROPERTY))) {
            throw new PackageSignatureException(
                    "Unsupported signature algorithm: " + properties.getProperty(ALGORITHM_PROPERTY));
        }
        String keyId = properties.getProperty("key", "");
        PublicKey key = trustedKeys.get(keyId);
        if (key == null) {
            throw new PackageSignatureException("The index is signed with the key " + keyId + ", which is not trusted");
        }
        if (!PackageSignatures.isValid(key, index, properties.getProperty("signature", ""))) {
            throw new PackageSignatureException("The signature of the index does not match the key " + keyId);
        }
        return keyId;
    }

    /** The signature file of an index. */
    static byte[] signature(byte[] index, KeyPair key) throws IOException {
        Properties properties = new Properties();
        properties.setProperty(ALGORITHM_PROPERTY, SigningKeys.ALGORITHM);
        properties.setProperty("key", SigningKeys.keyId(key.getPublic()));
        properties.setProperty(
                "signature", Base64.getEncoder().encodeToString(PackageSignatures.signatureOf(key, index)));
        StringWriter text = new StringWriter();
        properties.store(text, "Signature of " + INDEX_FILE);
        return text.toString().getBytes(StandardCharsets.ISO_8859_1);
    }

    /** The index as JSON, stable for the same packages. */
    static String toJson(List<Entry> entries, Instant generated) {
        StringBuilder json = new StringBuilder("{\n  \"format\": ")
                .append(FORMAT)
                .append(",\n  \"generated\": ")
                .append(quote(generated.toString()))
                .append(",\n  \"extensions\": [");
        for (int i = 0; i < entries.size(); i++) {
            Entry entry = entries.get(i);
            json.append(i == 0 ? "\n" : ",\n")
                    .append("    {\"id\": ")
                    .append(quote(entry.id()))
                    .append(", \"version\": ")
                    .append(quote(entry.version()))
                    .append(", \"name\": ")
                    .append(quote(entry.name()))
                    .append(", \"file\": ")
                    .append(quote(entry.file()))
                    .append(", \"sha256\": ")
                    .append(quote(entry.sha256()))
                    .append(", \"size\": ")
                    .append(entry.size())
                    .append(", \"publisherKey\": ")
                    .append(quote(entry.publisherKey()))
                    .append('}');
        }
        return json.append(entries.isEmpty() ? "]\n}\n" : "\n  ]\n}\n").toString();
    }

    static String quote(String text) {
        StringBuilder quoted = new StringBuilder("\"");
        for (char c : text.toCharArray()) {
            switch (c) {
                case '"' -> quoted.append("\\\"");
                case '\\' -> quoted.append("\\\\");
                case '\n' -> quoted.append("\\n");
                case '\r' -> quoted.append("\\r");
                case '\t' -> quoted.append("\\t");
                default -> {
                    if (c < 0x20) {
                        quoted.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
                    } else {
                        quoted.append(c);
                    }
                }
            }
        }
        return quoted.append('"').toString();
    }

    /**
     * The top-level {@code id}, {@code version} and {@code name} of the manifest of a package. The
     * kernel reads the whole manifest when it installs the package; the index needs only these.
     */
    static Map<String, String> identity(Path packageFile) throws IOException {
        try (ZipFile zip = new ZipFile(packageFile.toFile())) {
            ZipEntry manifest = zip.getEntry("manifest.yaml");
            if (manifest == null) {
                return Map.of();
            }
            Map<String, String> identity = new java.util.HashMap<>();
            try (InputStream in = zip.getInputStream(manifest)) {
                for (String line : new String(in.readNBytes(1024 * 1024), StandardCharsets.UTF_8).split("\\R")) {
                    Matcher matcher = TOP_LEVEL.matcher(line);
                    if (matcher.matches() && !identity.containsKey(matcher.group(1))) {
                        identity.put(matcher.group(1), unquote(matcher.group(2).strip()));
                    }
                }
            }
            return identity;
        }
    }

    private static String unquote(String value) {
        if (value.length() >= 2
                && (value.startsWith("'") && value.endsWith("'") || value.startsWith("\"") && value.endsWith("\""))) {
            return value.substring(1, value.length() - 1);
        }
        return value;
    }

    private static boolean isPackage(Path file) {
        return Files.isRegularFile(file)
                && file.getFileName().toString().toLowerCase(Locale.ROOT).endsWith(".zip");
    }
}
