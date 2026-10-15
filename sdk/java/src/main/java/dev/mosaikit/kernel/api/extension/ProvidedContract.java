// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.List;
import java.util.Objects;

/**
 * A contract on the server that an extension owns (MK-134), under {@code contracts.provides} of its
 * manifest: other extensions implement it, and the owner finds their implementations.
 *
 * @param name name of the contract within the extension, such as {@code connector}
 * @param versions the major versions the owner serves, in increasing order: a breaking change adds
 *     one, and the owner retires an old one by removing it
 * @param api the API artifact that holds the interfaces, {@code groupId:artifactId}, one of the
 *     libraries of the extension; empty when the contract has no Java interfaces
 */
public record ProvidedContract(String name, List<Integer> versions, String api) {

    public ProvidedContract {
        Objects.requireNonNull(name, "name");
        versions = List.copyOf(versions);
        api = Objects.requireNonNullElse(api, "");
    }

    /** Whether the owner serves this version. */
    public boolean serves(int version) {
        return versions.contains(version);
    }
}
