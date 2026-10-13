// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.resource;

import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.UUID;

/**
 * The registry of resources (MK-054, ADR-0037): an extension tells the kernel which resources it
 * keeps, so that sharing, favorites, trash, versions, tags, search and transfer of ownership work on
 * them without code of the extension. The data of a resource stay in the extension; the kernel keeps
 * only its {@link Resource entry}.
 *
 * <p>The kernel provides this bean to extensions. Every method acts on the organization of the
 * request ({@link dev.mosaikit.kernel.api.context.CurrentOrganization}) and joins the transaction of
 * the caller, so that a resource and its entry are written or rolled back together. An extension
 * registers only its own resources, of the types it declares in {@code resources} of its manifest;
 * any other reference is refused with {@link IllegalArgumentException}. Uninstalling an extension
 * removes its entries and everything built on them.
 *
 * <p>{@link #find} and {@link #list} do not check sharing: they serve the extension's own
 * bookkeeping. What a person may see and do is answered by {@link dev.mosaikit.kernel.api.sharing.Sharing}.
 *
 * <p><strong>API preview</strong>: the kernel implements it with MK-054.
 */
public interface Resources {

    /**
     * What an extension says about a resource and may change over its life.
     *
     * @param title what people see in the lists and dialogs of the kernel, at most
     *     {@value Resource#MAX_TITLE} characters
     * @param link where the resource opens, a path of the shell such as {@code /app/dashboards/42}
     * @param parent the resource that contains this one, or {@code null}; grants on the parent do not
     *     extend to it
     */
    record Details(String title, String link, ResourceRef parent) {

        /**
         * Checks the details.
         *
         * @throws IllegalArgumentException when the title or the link are not valid
         */
        public Details {
            title = Resource.checkTitle(title);
            Resource.checkLink(link);
        }

        /** Details of a resource without a parent. */
        public static Details of(String title, String link) {
            return new Details(title, link, null);
        }
    }

    /**
     * Registers a resource of the organization of the request, owned by the person of the request.
     * Registering a resource that is already registered changes its details and keeps its owner, so
     * that an extension can register again the resources it kept before it used the registry.
     *
     * @throws IllegalArgumentException when the type is not declared by the extension, or the parent
     *     is not a resource of the organization
     */
    Resource register(ResourceRef ref, Details details);

    /**
     * Changes the details of a registered resource, such as its title after a rename.
     *
     * @throws NoSuchElementException when the resource is not registered in the organization
     */
    Resource update(ResourceRef ref, Details details);

    /**
     * Removes a resource from the registry, with its grants and what the kernel built on it, when the
     * extension deletes it. Removing a resource that is not registered does nothing.
     */
    void remove(ResourceRef ref);

    /** The entry of a resource of the organization of the request, if it is registered. */
    Optional<Resource> find(ResourceRef ref);

    /**
     * The registered resources of one type of an extension in the organization of the request.
     *
     * @param owner the account of the owner, or {@code null} for every owner
     */
    List<Resource> list(String extension, String type, UUID owner);
}
