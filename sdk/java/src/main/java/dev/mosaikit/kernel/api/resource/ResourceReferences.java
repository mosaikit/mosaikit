// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.resource;

/**
 * References between resources of different extensions (MK-135, ADR-0041): a resource of one
 * extension, such as a dashboard widget, refers to a resource of another, such as a map, by its
 * {@link ResourceRef}, the identity the other extension gave it in the registry of resources
 * ({@link Resources}). The referring extension keeps the reference in its own data; the kernel
 * resolves it, for the person of the request, to the resource or to the reason it is not available.
 *
 * <p>An absent extension changes nothing: the kernel never deletes or changes a reference, nor the
 * referring or the referred resource, because an extension is not installed or is turned off in an
 * organization. The reference resolves to {@link ResolvedReference.Availability#EXTENSION_ABSENT}
 * while the other extension is away, and to the resource again as soon as it comes back, with
 * nothing to repair: the referring extension shows a placeholder meanwhile (the frontend SDK gives it
 * as the element {@code mk-reference-placeholder}) and keeps working. To take the reference up again
 * at once, it subscribes to the presence of the other extension ({@link
 * dev.mosaikit.kernel.api.extension.ExtensionPresence}).
 *
 * <pre>{@code
 * @Inject ResourceReferences references;
 *
 * ResolvedReference map = references.resolve("org.example.ext.dashboards", widget.map());
 * if (map.isAvailable()) {
 *     // show map.resource().title(), open map.resource().link()
 * } else {
 *     // keep widget.map() as it is, and say why it is missing: map.availability()
 * }
 * }</pre>
 *
 * <p>The kernel provides this bean to extensions. It acts on the organization of the request. The
 * calling extension names itself, as {@code Notifications.send} does; the kernel checks that it is an
 * active extension, and refuses any other with {@link IllegalArgumentException}. Any extension may
 * refer to the resources of any other: the referred extension does not need to be declared in the
 * manifest.
 */
public interface ResourceReferences {

    /**
     * Resolves a reference to a resource of another extension, or of the calling one, for the person
     * of the request.
     *
     * @param extension identifier of the calling extension, the one that keeps the reference
     * @param target the referred resource
     * @return the resource when the person may read it, otherwise why it is not available: its
     *     extension is absent from the organization, it is no longer registered, or the person has no
     *     level on it
     * @throws IllegalArgumentException when the calling extension is not an active extension
     * @throws dev.mosaikit.kernel.api.context.NoOrganizationException when the request has no
     *     organization
     */
    ResolvedReference resolve(String extension, ResourceRef target);
}
