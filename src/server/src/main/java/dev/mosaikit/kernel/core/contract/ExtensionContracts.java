// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.contract;

import dev.mosaikit.kernel.api.contract.Contract;
import dev.mosaikit.kernel.api.contract.ContractImplementation;
import dev.mosaikit.kernel.api.contract.Contracts;
import dev.mosaikit.kernel.api.extension.ExtensionPresence;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Any;
import jakarta.enterprise.inject.Instance;
import java.util.Comparator;
import java.util.List;
import org.jboss.logging.Logger;

/**
 * Gives the owner of a contract between extensions its implementations (MK-134): the CDI beans of the
 * interface whose extension is active in the organization of the request ({@link ExtensionPresence},
 * MK-133) and declares, in its
 * manifest, the contract and the version of the interface. The beans of every Java extension are in
 * the kernel; which of them count changes as soon as an extension is installed, removed, or turned off
 * or on, without a change to the owner.
 */
@ApplicationScoped
public class ExtensionContracts implements Contracts {

    private static final Logger LOG = Logger.getLogger(ExtensionContracts.class);

    private final Instance<ContractImplementation> beans;
    private final ExtensionRegistry registry;
    private final ExtensionPresence presence;

    public ExtensionContracts(
            @Any Instance<ContractImplementation> beans, ExtensionRegistry registry, ExtensionPresence presence) {
        this.beans = beans;
        this.registry = registry;
        this.presence = presence;
    }

    @Override
    public <T extends ContractImplementation> List<T> implementations(Class<T> contract) {
        Contract declared = contract.getAnnotation(Contract.class);
        if (declared == null || !contract.isInterface()) {
            throw new IllegalArgumentException(contract.getName()
                    + " is not a contract: mark the interface with @Contract(extension, name, version)");
        }
        return beans.select(contract).stream()
                .filter(implementation -> declares(implementation.extension(), declared))
                .filter(implementation -> presence.isActive(implementation.extension()))
                .sorted(Comparator.comparing(ContractImplementation::extension))
                .toList();
    }

    /** Whether the extension says in its manifest that it implements this version of the contract. */
    private boolean declares(String extension, Contract contract) {
        boolean declared = registry.findActive(extension)
                .flatMap(installed -> installed.manifest())
                .map(manifest -> manifest.implementsContract(contract.extension(), contract.name(), contract.version()))
                .orElse(false);
        if (!declared && registry.findActive(extension).isPresent()) {
            LOG.debugf(
                    "Extension %s has an implementation of %s/%s version %d that its manifest does not declare",
                    extension, contract.extension(), contract.name(), contract.version());
        }
        return declared;
    }
}
