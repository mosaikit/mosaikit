// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.extension;

import java.util.List;

/**
 * Fired each time the kernel reads the extensions directory again, at start too, after the
 * extensions in use have changed: so that what follows the active extensions, such as their presence
 * in organizations (MK-133), sees each change once.
 *
 * @param all every extension found, whatever its status
 */
public record ExtensionsReloaded(List<InstalledExtension> all) {

    public ExtensionsReloaded {
        all = List.copyOf(all);
    }

    /** The extensions that can be used. */
    public List<InstalledExtension> active() {
        return all.stream().filter(InstalledExtension::isActive).toList();
    }
}
