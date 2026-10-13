// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.permission;

import java.util.Set;

/**
 * What the person of the request may do in an extension (MK-056, ADR-0038): the permissions the
 * extension declares in {@code permissions} of its manifest, such as {@code create-dashboard}.
 *
 * <p>Permissions say what a person may do; sharing ({@link dev.mosaikit.kernel.api.sharing.Sharing})
 * says on which resources. The rules the kernel applies:
 *
 * <ul>
 *   <li><strong>Deny by default.</strong> A person has a permission only when something grants it;
 *       a request without a person, such as one through a link or from the public, has none.
 *   <li><strong>Grants only add.</strong> The profile of the person, the groups they belong to and
 *       their personal exceptions each add permissions; nothing removes one that another grants.
 *       Profiles are named sets of permissions kept by the kernel and edited by the administrators of
 *       the organization; extensions do not see them.
 *   <li><strong>New permissions arrive switched off.</strong> A permission that an updated extension
 *       adds to its manifest is in no profile until an administrator puts it there.
 *   <li>When all the apps of an extension are turned off for the organization (MK-030), the person
 *       has none of its permissions.
 * </ul>
 *
 * <p>The extension enforces the answers in its backend, at every request that needs a permission,
 * with {@link #require}: the interface only hides what is not available, and a request that goes
 * around it must still be refused. The kernel provides this bean to extensions and is the authority;
 * every change of profiles, groups and exceptions is in the audit log (MK-059).
 *
 * <p><strong>API preview</strong>: the kernel implements it with MK-056.
 */
public interface Permissions {

    /**
     * Whether the person of the request has a permission of an extension in the organization of the
     * request. A permission the extension does not declare is never granted.
     *
     * @param extension identifier of the extension that declares the permission
     * @param permission name of the permission in the manifest, such as {@code create-dashboard}
     */
    boolean has(String extension, String permission);

    /**
     * The names of the permissions of an extension that the person of the request has, for an API
     * that tells its frontend what to show.
     */
    Set<String> granted(String extension);

    /**
     * Refuses the request unless the person of the request has the permission.
     *
     * @throws AccessDeniedException when the person lacks it; the kernel answers {@code 403}
     */
    default void require(String extension, String permission) {
        if (!has(extension, permission)) {
            throw new AccessDeniedException("You do not have the permission " + permission + " of " + extension);
        }
    }
}
