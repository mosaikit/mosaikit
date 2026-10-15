// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.resources;

import dev.mosaikit.kernel.api.extension.ExtensionManifest;
import dev.mosaikit.kernel.api.resource.ResolvedReference;
import dev.mosaikit.kernel.api.resource.ResolvedReference.Availability;
import dev.mosaikit.kernel.api.resource.Resource;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.ExtensionStatus;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import dev.mosaikit.kernel.core.identity.RequestOrganization;
import dev.mosaikit.kernel.core.resources.ResourceReferencesResource.Missing;
import dev.mosaikit.kernel.core.resources.ResourceReferencesResource.ReferenceView;
import dev.mosaikit.kernel.core.security.Roles;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Locale;
import java.util.Optional;

/**
 * How the REST API shows a resolved reference (MK-135), shared by the features of the kernel that list
 * references for people, such as their favorites (MK-094): the status, and to administrators which
 * extension an absent one needs and what brings it back.
 */
@ApplicationScoped
public class ReferenceViews {

    private final ExtensionRegistry extensions;

    public ReferenceViews(ExtensionRegistry extensions) {
        this.extensions = extensions;
    }

    /** Whether the person of the request is told which extension to install or turn on. */
    public static boolean administrator(SecurityIdentity identity) {
        return RequestOrganization.administrator(identity) || identity.hasRole(Roles.PLATFORM_ADMIN);
    }

    /** As {@code available}, {@code extension-absent}, {@code deleted} or {@code forbidden}. */
    public static String status(Availability availability) {
        return availability.name().toLowerCase(Locale.ROOT).replace('_', '-');
    }

    /** The view of a resolved reference; {@code missing} only for administrators. */
    public ReferenceView view(ResolvedReference resolved, boolean administrator) {
        ResourceRef target = resolved.target();
        Resource resource = resolved.resource();
        return new ReferenceView(
                target.extension(),
                target.type(),
                target.id(),
                status(resolved.availability()),
                resource == null ? null : resource.title(),
                resource == null ? null : resource.link(),
                missing(resolved, administrator));
    }

    /** For administrators, when the extension of the reference is absent: which one, and what brings it back. */
    public Missing missing(ResolvedReference resolved, boolean administrator) {
        return administrator && resolved.availability() == Availability.EXTENSION_ABSENT
                ? missing(resolved.target().extension())
                : null;
    }

    private Missing missing(String extension) {
        Optional<InstalledExtension> installed = extensions.all().stream()
                .filter(found -> found.key().equals(extension))
                .findFirst();
        String name = installed
                .flatMap(InstalledExtension::manifest)
                .map(ExtensionManifest::name)
                .orElse(null);
        String action;
        if (installed.isEmpty()) {
            action = "install";
        } else if (installed.get().isActive()) {
            // Active in the installation, absent in the organization: its apps are turned off there.
            action = "turn-on";
        } else if (installed.get().status() == ExtensionStatus.RESTART_REQUIRED) {
            action = "restart";
        } else {
            action = "repair";
        }
        return new Missing(extension, name, action);
    }
}
