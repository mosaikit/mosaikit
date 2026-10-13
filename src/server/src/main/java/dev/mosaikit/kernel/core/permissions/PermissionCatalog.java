// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.permissions;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.extension.PermissionEntry;
import dev.mosaikit.kernel.api.permission.PermissionId;
import dev.mosaikit.kernel.core.apps.AppPermissions;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * The permissions that the active extensions declare in their manifests (MK-056), and the permission
 * of each of their apps ({@link AppPermissions}, MK-030): the only ones the kernel ever grants. A permission that an extension no longer declares, or of an extension that is
 * not active, is never granted, whatever the profiles, teams and exceptions say.
 */
@ApplicationScoped
public class PermissionCatalog {

    /**
     * A permission declared by an active extension, as the API of the kernel names it.
     *
     * @param id qualified identifier, {@code <extension>:<permission>}
     * @param extension identifier of the extension
     * @param extensionName name of the extension
     * @param name name of the permission in the manifest
     * @param title short name shown to administrators
     * @param description what the permission allows, possibly empty
     * @param i18n {@code title} and {@code description} in other languages
     * @param app the app that the permission opens, for the permission of an app ({@link
     *     AppPermissions}); {@code null} for a permission of the manifest
     */
    public record Declared(
            String id,
            String extension,
            String extensionName,
            String name,
            String title,
            String description,
            Map<String, Map<String, String>> i18n,
            String app) {

        static Declared of(ExtensionManifest manifest, PermissionEntry entry) {
            return new Declared(
                    new PermissionId(manifest.id(), entry.name()).toString(),
                    manifest.id(),
                    manifest.name(),
                    entry.name(),
                    entry.title(),
                    entry.description(),
                    entry.i18n(),
                    AppPermissions.appOf(manifest, entry.name()).orElse(null));
        }

        /** The qualified identifier. */
        public PermissionId permissionId() {
            return new PermissionId(extension, name);
        }
    }

    private final Function<String, Optional<ExtensionManifest>> manifests;
    private final Supplier<List<ExtensionManifest>> active;

    @Inject
    public PermissionCatalog(ExtensionRegistry extensions) {
        this(
                id -> extensions.findActive(id).flatMap(InstalledExtension::manifest),
                () -> extensions.active().stream()
                        .flatMap(extension -> extension.manifest().stream())
                        .toList());
    }

    PermissionCatalog(
            Function<String, Optional<ExtensionManifest>> manifests, Supplier<List<ExtensionManifest>> active) {
        this.manifests = manifests;
        this.active = active;
    }

    /**
     * The manifest of the calling extension, which must be active.
     *
     * @throws IllegalArgumentException when no active extension has that identifier
     */
    public ExtensionManifest requireActive(String extension) {
        Objects.requireNonNull(extension, "extension");
        return manifests
                .apply(extension)
                .orElseThrow(() -> new IllegalArgumentException(extension + " is not an active extension."));
    }

    /** Whether an active extension declares the permission. */
    public boolean isDeclared(PermissionId permission) {
        return manifests
                .apply(permission.extension())
                .map(manifest -> declares(manifest, permission.name()))
                .orElse(false);
    }

    /** The permission, when an active extension declares it. */
    public Optional<Declared> find(PermissionId permission) {
        return manifests
                .apply(permission.extension())
                .flatMap(manifest -> AppPermissions.withApps(manifest).stream()
                        .filter(entry -> entry.name().equals(permission.name()))
                        .findFirst()
                        .map(entry -> Declared.of(manifest, entry)));
    }

    /** Whether a manifest declares a permission by that name, or has an app whose permission it is. */
    public static boolean declares(ExtensionManifest manifest, String permission) {
        return manifest.permissions().stream().anyMatch(entry -> entry.name().equals(permission))
                || AppPermissions.appOf(manifest, permission).isPresent();
    }

    /** Every permission of the active extensions, by extension and then in the order of the manifest. */
    public List<Declared> all() {
        List<Declared> found = new ArrayList<>();
        active.get().stream()
                .sorted(Comparator.comparing(ExtensionManifest::id))
                .forEach(manifest ->
                        AppPermissions.withApps(manifest).forEach(entry -> found.add(Declared.of(manifest, entry))));
        return found;
    }

    /** Every permission of one active extension, in the order of its manifest. */
    public List<Declared> of(String extension) {
        return manifests.apply(extension).stream()
                .flatMap(manifest ->
                        AppPermissions.withApps(manifest).stream().map(entry -> Declared.of(manifest, entry)))
                .toList();
    }
}
