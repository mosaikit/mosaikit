// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import java.nio.file.Path;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * An extension found in the installation directory, with the result of its checks.
 *
 * @param key extension identifier, or the directory name when the manifest cannot be read
 * @param directory root directory of the extension
 * @param manifest the manifest, present unless the extension is {@link ExtensionStatus#INVALID}
 * @param status outcome of the checks
 * @param problems human readable reasons for a status other than {@link ExtensionStatus#ACTIVE}
 * @param publisherKey identifier of the trusted key that signed the package of the extension; empty
 *     for an extension directory, an unsigned package or a key the installation does not trust (MK-013)
 */
public record InstalledExtension(
        String key,
        Path directory,
        Optional<ExtensionManifest> manifest,
        ExtensionStatus status,
        List<String> problems,
        Optional<String> publisherKey) {

    public InstalledExtension {
        Objects.requireNonNull(key, "key");
        Objects.requireNonNull(directory, "directory");
        Objects.requireNonNull(status, "status");
        manifest = Objects.requireNonNullElse(manifest, Optional.empty());
        problems = List.copyOf(problems);
        publisherKey = Objects.requireNonNullElse(publisherKey, Optional.empty());
    }

    /** An extension whose publisher is not verified. */
    public InstalledExtension(
            String key,
            Path directory,
            Optional<ExtensionManifest> manifest,
            ExtensionStatus status,
            List<String> problems) {
        this(key, directory, manifest, status, problems, Optional.empty());
    }

    /** Whether a key trusted by the installation signed the package of the extension. */
    public boolean isVerified() {
        return publisherKey.isPresent();
    }

    /** This extension, published by the owner of a trusted key. */
    InstalledExtension verifiedBy(String keyId) {
        return new InstalledExtension(key, directory, manifest, status, problems, Optional.of(keyId));
    }

    /** The declared JAR of the extension, resolved inside its directory, if it brings Java code. */
    public Optional<Path> backendJar() {
        return manifest.flatMap(ExtensionManifest::backend).map(backend -> directory.resolve(backend.jar()));
    }

    /** Returns {@code true} when the extension can be used. */
    public boolean isActive() {
        return status == ExtensionStatus.ACTIVE;
    }
}
