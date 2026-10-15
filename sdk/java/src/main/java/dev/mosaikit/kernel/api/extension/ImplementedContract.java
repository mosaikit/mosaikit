// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.extension;

import java.util.Objects;

/**
 * A contract of another extension that an extension implements (MK-134), under {@code
 * contracts.implements} of its manifest, with the version it targets.
 *
 * @param extension the extension that owns the contract
 * @param name the name of the contract within that extension
 * @param version the major version of the contract it implements
 * @param api the API artifact of the contract, {@code groupId:artifactId}, one of the libraries of the
 *     extension; empty when the extension does not bring it
 */
public record ImplementedContract(String extension, String name, int version, String api) {

    /** Separates the extension from the name of a contract: {@code org.example.catalog/connector}. */
    public static final String SEPARATOR = "/";

    public ImplementedContract {
        Objects.requireNonNull(extension, "extension");
        Objects.requireNonNull(name, "name");
        api = Objects.requireNonNullElse(api, "");
    }

    /** The contract as written in the manifest: {@code <extension>/<name>}. */
    public String contract() {
        return extension + SEPARATOR + name;
    }
}
