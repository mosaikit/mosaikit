// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.marketplace;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * The plugins that the catalogs of the installation offer.
 *
 * @param sources each catalog, and whether its index could be read and verified
 * @param plugins the offered packages, with what is installed of them
 */
public record CatalogView(List<Source> sources, List<Offer> plugins) {

    /**
     * A catalog.
     *
     * @param uri directory of the catalog
     * @param status {@code verified}, or {@code refused} with the reason in {@code error}
     * @param keyId the trusted key that signed its index
     * @param error why the catalog cannot be used
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Source(String uri, String status, String keyId, String error) {}

    /**
     * A package offered by a catalog.
     *
     * @param source directory of the catalog
     * @param id identifier of the plugin
     * @param version version of the package
     * @param name human readable name
     * @param size size of the package in bytes
     * @param publisherKey key that signed the package
     * @param installedVersion version installed, if any
     * @param state {@code available}, {@code installed}, {@code update}, {@code older}, or {@code restart}
     *     when the package of this version is in the plugins directory and waits for a restart
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    public record Offer(
            String source,
            String id,
            String version,
            String name,
            long size,
            String publisherKey,
            String installedVersion,
            String state) {}
}
