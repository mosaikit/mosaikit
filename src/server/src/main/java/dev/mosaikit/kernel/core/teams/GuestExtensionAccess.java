// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.teams;

import dev.mosaikit.kernel.api.extension.BackendEntry;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.permissions.PermissionResolver;
import dev.mosaikit.kernel.core.permissions.PermissionResolver.Holder;
import dev.mosaikit.kernel.core.permissions.PermissionResolver.Standing;
import dev.mosaikit.kernel.core.resources.RegisteredResources;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.util.Optional;
import java.util.UUID;

/**
 * Whether a guest of an organization (MK-032) may call the API of an extension: only when the
 * organization gave them something of it, a permission of the extension through a team of theirs or
 * a personal exception (MK-056), or a resource of the extension that they own or that is shared with
 * them or with a team of theirs (MK-055). What they reach in it stays up to the checks of the extension, {@code Permissions}
 * and {@code Sharing}, which answer for guests with the same rules.
 */
@ApplicationScoped
public class GuestExtensionAccess {

    private final ExtensionRegistry extensions;
    private final PermissionResolver permissions;
    private final RegisteredResources resources;

    public GuestExtensionAccess(
            ExtensionRegistry extensions, PermissionResolver permissions, RegisteredResources resources) {
        this.extensions = extensions;
        this.permissions = permissions;
        this.resources = resources;
    }

    /**
     * Whether the guest may call the API named {@code api}.
     *
     * @param organization the organization of the request
     * @param account the guest
     * @param api the API name of the path, {@code /api/v1/ext/<api>/}
     */
    @Transactional
    public boolean allows(UUID organization, UUID account, String api) {
        Optional<String> extension = extensionOf(api);
        if (extension.isEmpty()) {
            return false;
        }
        boolean holdsOne = permissions.effective(organization, Holder.of(Standing.GUEST, account)).held().stream()
                .anyMatch(permission -> permission.extension().equals(extension.get()));
        return holdsOne || resources.reachableBy(organization, extension.get(), account) > 0;
    }

    /** The active extension whose backend serves the API. */
    private Optional<String> extensionOf(String api) {
        return extensions.active().stream()
                .map(InstalledExtension::manifest)
                .flatMap(Optional::stream)
                .filter(manifest -> manifest.backend()
                        .map(BackendEntry::api)
                        .filter(api::equals)
                        .isPresent())
                .map(manifest -> manifest.id())
                .findFirst();
    }
}
