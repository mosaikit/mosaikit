// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.Objects;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * A library that the Java code of an extension brings (MK-131): a JAR of the package that the launcher
 * adds to the kernel with the JAR of the extension. The parent POM of extensions writes these entries
 * from the runtime dependencies of the extension, leaving out what the kernel provides.
 *
 * <p>A library is identified by its {@link #key() key}, {@code groupId:artifactId} (with the classifier,
 * if any): the kernel holds one version of each, so it refuses an extension that brings a library
 * the kernel or another extension has in another version.
 *
 * @param jar path of the JAR, relative to the extension root
 * @param groupId Maven group of the library
 * @param artifactId Maven artifact of the library
 * @param version version of the library, compared exactly
 * @param classifier Maven classifier, empty when the library has none
 * @param sha256 SHA-256 digest of the JAR, in lowercase hexadecimal
 */
public record LibraryEntry(
        String jar, String groupId, String artifactId, String version, String classifier, String sha256) {

    /** Maven coordinates: {@code groupId:artifactId:version} or {@code groupId:artifactId:version:classifier}. */
    public static final Pattern COORDINATES_PATTERN =
            Pattern.compile("^([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([A-Za-z0-9_.+-]+)(?::([A-Za-z0-9_.-]+))?$");

    /** SHA-256 digest in lowercase hexadecimal. */
    public static final Pattern SHA256_PATTERN = Pattern.compile("^[0-9a-f]{64}$");

    public LibraryEntry {
        Objects.requireNonNull(jar, "jar");
        Objects.requireNonNull(groupId, "groupId");
        Objects.requireNonNull(artifactId, "artifactId");
        Objects.requireNonNull(version, "version");
        classifier = Objects.requireNonNullElse(classifier, "");
        Objects.requireNonNull(sha256, "sha256");
    }

    /**
     * A library from its Maven coordinates, empty when they are not valid.
     *
     * @param coordinates {@code groupId:artifactId:version[:classifier]}
     */
    public static Optional<LibraryEntry> of(String jar, String coordinates, String sha256) {
        Matcher matcher = COORDINATES_PATTERN.matcher(coordinates);
        if (!matcher.matches()) {
            return Optional.empty();
        }
        return Optional.of(new LibraryEntry(
                jar,
                matcher.group(1),
                matcher.group(2),
                matcher.group(3),
                Objects.requireNonNullElse(matcher.group(4), ""),
                sha256));
    }

    /** What identifies the library whatever its version: {@code groupId:artifactId[:classifier]}. */
    public String key() {
        return key(groupId, artifactId, classifier);
    }

    /** The key of a library, see {@link #key()}. */
    public static String key(String groupId, String artifactId, String classifier) {
        return groupId + ":" + artifactId + (classifier == null || classifier.isEmpty() ? "" : ":" + classifier);
    }

    /** Maven coordinates: {@code groupId:artifactId:version[:classifier]}. */
    public String coordinates() {
        return groupId + ":" + artifactId + ":" + version + (classifier.isEmpty() ? "" : ":" + classifier);
    }
}
