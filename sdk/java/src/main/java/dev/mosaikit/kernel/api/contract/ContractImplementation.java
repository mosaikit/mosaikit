// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.contract;

/**
 * What every interface of a contract between extensions extends (MK-134): an implementation names
 * the extension it belongs to, so that the kernel gives it to the owner of the contract only where
 * that extension is active.
 *
 * <pre>{@code
 * @ApplicationScoped
 * public class FilesConnector implements Connector {
 *     public String extension() { return "org.example.catalog.connector.files"; }
 *     public List<Item> items(String connection) { ... }
 * }
 * }</pre>
 */
public interface ContractImplementation {

    /** The identifier of the extension of this implementation, which declares the contract it implements. */
    String extension();
}
