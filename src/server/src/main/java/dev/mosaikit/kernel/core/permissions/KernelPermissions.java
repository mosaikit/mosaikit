// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.permissions;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.permission.PermissionId;
import dev.mosaikit.kernel.api.permission.Permissions;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.permissions.PermissionResolver.Holder;
import dev.mosaikit.kernel.core.permissions.PermissionResolver.Standing;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The kernel's {@link Permissions} bean (MK-056, ADR-0038): what the person of the request may do in
 * the calling extension, in the organization of the request. The calling extension names itself and
 * must be active; a permission its manifest does not declare is never granted. The rules are those
 * of {@link PermissionResolver}.
 */
@ApplicationScoped
public class KernelPermissions implements Permissions {

    private final PermissionResolver resolver;
    private final PermissionCatalog catalog;
    private final SecurityIdentity identity;

    public KernelPermissions(PermissionResolver resolver, PermissionCatalog catalog, SecurityIdentity identity) {
        this.resolver = resolver;
        this.catalog = catalog;
        this.identity = identity;
    }

    /**
     * {@inheritDoc}
     *
     * @throws IllegalArgumentException when {@code extension} is not an active extension
     */
    @Override
    public boolean has(String extension, String permission) {
        Objects.requireNonNull(permission, "permission");
        ExtensionManifest manifest = catalog.requireActive(extension);
        if (!PermissionCatalog.declares(manifest, permission)) {
            return false;
        }
        Optional<UUID> organization = RequestOrganization.of(identity);
        if (organization.isEmpty()) {
            return false;
        }
        return resolver.holds(organization.get(), holder(), new PermissionId(extension, permission));
    }

    /**
     * {@inheritDoc}
     *
     * @throws IllegalArgumentException when {@code extension} is not an active extension
     */
    @Override
    public Set<String> granted(String extension) {
        catalog.requireActive(extension);
        return held().stream()
                .filter(permission -> permission.extension().equals(extension))
                .map(PermissionId::name)
                .collect(Collectors.toUnmodifiableSet());
    }

    /** Every permission the person of the request holds in its organization, in every active extension. */
    public List<PermissionId> held() {
        Optional<UUID> organization = RequestOrganization.of(identity);
        if (organization.isEmpty()) {
            return List.of();
        }
        return resolver.effective(organization.get(), holder()).held();
    }

    /** The qualified identifiers of {@link #held()}, sorted. */
    public Set<String> heldIds() {
        return held().stream().map(PermissionId::toString).collect(Collectors.toCollection(TreeSet::new));
    }

    private Holder holder() {
        Optional<UUID> account = RequestOrganization.account(identity);
        Standing standing = identity == null || identity.isAnonymous() || account.isEmpty()
                ? Standing.NONE
                : Standing.of(identity.getRoles());
        return Holder.of(standing, account.orElse(null));
    }
}
