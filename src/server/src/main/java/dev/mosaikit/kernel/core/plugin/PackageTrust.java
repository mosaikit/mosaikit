// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.plugin;

import dev.mosaikit.kernel.api.signature.SigningKeys;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Path;
import java.security.PublicKey;
import java.util.Map;
import java.util.Objects;

/**
 * What an installation accepts from plugin publishers (MK-013): the public keys it trusts and
 * whether every plugin must be a package signed with one of them. The kernel and the launcher build
 * it from the same settings, so they always agree on which plugins can run.
 *
 * @param trustedKeys public keys of trusted publishers, by key identifier
 * @param signaturesRequired {@code true} when unsigned packages, packages signed with an unknown key
 *     and plugin directories are refused
 */
public record PackageTrust(Map<String, PublicKey> trustedKeys, boolean signaturesRequired) {

    /** Setting that requires signatures ({@code mosaikit.plugins.signatures}). */
    public static final String REQUIRED = "required";

    public PackageTrust {
        trustedKeys = Map.copyOf(Objects.requireNonNull(trustedKeys, "trustedKeys"));
    }

    /** Trusts no key and accepts unsigned plugins: the behaviour without any setting. */
    public static PackageTrust none() {
        return new PackageTrust(Map.of(), false);
    }

    /**
     * Reads the trusted keys of a directory ({@code *.pub.pem}); a missing directory trusts none.
     *
     * @param signatures {@code required} or {@code optional}, case-insensitive; blank means optional
     */
    public static PackageTrust read(Path trustedKeysDirectory, String signatures) {
        String policy = signatures == null ? "" : signatures.strip();
        if (!policy.isEmpty() && !policy.equalsIgnoreCase(REQUIRED) && !policy.equalsIgnoreCase("optional")) {
            throw new IllegalArgumentException(
                    "mosaikit.plugins.signatures must be 'required' or 'optional', not '" + signatures + "'");
        }
        try {
            return new PackageTrust(SigningKeys.readTrusted(trustedKeysDirectory), policy.equalsIgnoreCase(REQUIRED));
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read the trusted keys in " + trustedKeysDirectory, e);
        }
    }
}
