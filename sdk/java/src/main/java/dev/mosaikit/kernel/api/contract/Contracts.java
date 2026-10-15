// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.contract;

import java.util.List;

/**
 * Finds the implementations of a contract between extensions (MK-134). The kernel provides this bean;
 * the extension that owns a contract injects it and asks for the implementations each time it needs
 * them, since they change when an extension is installed, removed, or turned off or on in an
 * organization, without a change to the owner.
 *
 * <pre>{@code
 * @Inject Contracts contracts;
 *
 * List<Connector> connectors = contracts.implementations(Connector.class);
 * }</pre>
 */
public interface Contracts {

    /**
     * The implementations of one version of a contract: the CDI beans of that interface whose extension
     * is active, is not turned off in the organization of the request (or of the job), and declares
     * under {@code contracts.implements} of its manifest the contract and the version of the interface.
     * Without an organization, those of the active extensions. Sorted by extension.
     *
     * @param contract an interface marked with {@link Contract}
     * @throws IllegalArgumentException when the interface is not marked with {@link Contract}
     */
    <T extends ContractImplementation> List<T> implementations(Class<T> contract);
}
