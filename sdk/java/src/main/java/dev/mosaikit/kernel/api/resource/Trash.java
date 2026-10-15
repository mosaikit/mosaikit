// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.resource;

import java.util.List;
import java.util.NoSuchElementException;
import java.util.Set;

/**
 * The trash of the registered resources (MK-095): an extension moves a resource to the trash instead
 * of deleting it, and its owner or an administrator of the organization restores it from the page
 * <em>Trash</em> of the shell for the retention of the installation, after which the kernel deletes it
 * for good.
 *
 * <p>The kernel provides this bean to extensions. Every method acts on the organization of the
 * request and joins the transaction of the caller. As with {@link Resources}, the calling extension
 * names itself in the reference, and only an active extension that declares the type uses it; the
 * extension checks first that the person may delete the resource, as it does before deleting it.
 *
 * <p><strong>What goes with it.</strong> The resources inside a resource, by the parent of the
 * registry and whatever their type or extension, go to the trash with it and come back with it. A
 * resource that was already in the trash stays there on its own.
 *
 * <p><strong>While in the trash</strong> a resource keeps its entry, its grants and its data, but gives
 * no level to anyone ({@link dev.mosaikit.kernel.api.sharing.Sharing} answers that nobody holds one,
 * and {@code mk_kernel.allows()} is false), and its links answer not found. Restoring it brings it back
 * with its grants and its links as they were.
 *
 * <p><strong>What the extension does.</strong> It hides the resources {@link #trash} returns, and
 * subscribes to the events of the kernel {@link dev.mosaikit.kernel.api.events.PlatformEvents#RESOURCE_RESTORED}
 * (show it again) and {@link dev.mosaikit.kernel.api.events.PlatformEvents#RESOURCE_PURGED} (delete its
 * data for good: the kernel already removed the entry). Both come once for each resource, for the
 * resources of every extension: keep only those whose {@code extension} is yours.
 *
 * <p><strong>API preview</strong>: the kernel implements it with MK-095.
 */
public interface Trash {

    /**
     * Moves a resource to the trash, with the resources inside it that are not there yet; each raises
     * {@link dev.mosaikit.kernel.api.events.PlatformEvents#RESOURCE_TRASHED}. A resource already in the
     * trash stays as it is.
     *
     * @return the resources moved to the trash, the given one first; empty when it was already there
     * @throws IllegalArgumentException when the type is not declared by the extension
     * @throws NoSuchElementException when the resource is not registered in the organization
     */
    List<ResourceRef> trash(ResourceRef ref);

    /**
     * Brings back a resource from the trash with the resources that went there with it, as the page
     * <em>Trash</em> does, for an extension that offers to undo a deletion; each raises
     * {@link dev.mosaikit.kernel.api.events.PlatformEvents#RESOURCE_RESTORED}. A resource not in the
     * trash stays as it is.
     *
     * @return the resources brought back, the given one first; empty when it was not in the trash
     * @throws IllegalArgumentException when the type is not declared by the extension, or the resource
     *     went to the trash with the resource that contains it, or the resource that contains it is in
     *     the trash: restore that one
     * @throws NoSuchElementException when the resource is not registered in the organization
     */
    List<ResourceRef> restore(ResourceRef ref);

    /**
     * Whether a resource of the organization is in the trash.
     *
     * @throws IllegalArgumentException when the type is not declared by the extension
     */
    boolean contains(ResourceRef ref);

    /**
     * The identifiers of the resources of one type of the extension that are in the trash, to leave out
     * of its lists.
     *
     * @param extension identifier of the calling extension
     * @param type a resource type the extension declares
     * @throws IllegalArgumentException when the type is not declared by the extension
     */
    Set<String> trashed(String extension, String type);
}
