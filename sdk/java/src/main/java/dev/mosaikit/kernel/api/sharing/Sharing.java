// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.sharing;

import dev.mosaikit.kernel.api.permission.AccessDeniedException;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import java.time.Instant;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * One sharing model for the resources of every extension (MK-055, ADR-0037): a registered resource
 * ({@link dev.mosaikit.kernel.api.resource.Resources}) is shared with a {@link Subject} at a level
 * that the extension declares for its type, and the kernel answers which level a person has on it.
 *
 * <p>The rules the kernel applies:
 *
 * <ul>
 *   <li><strong>Levels are ordered.</strong> The manifest lists the levels of a type from the lowest
 *       to the highest, such as {@code view}, {@code use}, {@code edit}, {@code manage}; each level
 *       includes those before it, so "at least {@code edit}" also holds for {@code manage}.
 *   <li><strong>Deny by default.</strong> A person has no level on a resource unless its owner is
 *       them or a grant reaches them: a grant to them, to a group they belong to, to their
 *       organization, to a link they opened, or to the public. The owner has the highest level.
 *   <li><strong>Grants only add.</strong> The level of a person is the highest of the levels that
 *       reach them; there is no grant that removes a level, and a grant on a parent resource does not
 *       extend to the resources it contains.
 *   <li><strong>Who shares.</strong> The owner, the administrators of the organization and the
 *       people with the highest level of the type grant and revoke; a grant never gives a level
 *       higher than the one of the person who makes it.
 *   <li><strong>The kernel is the authority.</strong> It keeps the grants, offers the same sharing
 *       dialog for every type, and writes every grant, revocation and use of a link in the audit log
 *       (MK-059). The extension enforces its answers in its backend, at every request on a resource,
 *       with {@link #require}: hiding a button is not a check. An extension that serves its resources
 *       through another server translates the grants into the rules of that server, and the kernel
 *       stays the authority.
 *   <li>Sharing says on which resources a person may act; permissions
 *       ({@link dev.mosaikit.kernel.api.permission.Permissions}) say what a person may do at all. The
 *       backend checks both.
 * </ul>
 *
 * <p>Methods without a {@code person} answer for the request: the signed-in person, or the link the
 * request was opened with, or the public when there is neither. Every method acts on the
 * organization of the request; a resource that is not registered there has no grants and gives no
 * level. The kernel provides this bean to extensions.
 *
 * <p><strong>API preview</strong>: the kernel implements it with MK-055.
 */
public interface Sharing {

    /**
     * Shares a resource with a subject, as the person of the request. A subject has at most one grant
     * on a resource: sharing again with the same subject replaces its level.
     *
     * @param subject a person, a group, the organization or the public; links are made with
     *     {@link #createLink}
     * @param level a level declared for the type of the resource
     * @throws IllegalArgumentException when the level is not declared for the type, or the type does
     *     not accept the kind of the subject
     * @throws AccessDeniedException when the person of the request may not share the resource
     * @throws NoSuchElementException when the resource is not registered in the organization
     */
    Grant grant(ResourceRef resource, Subject subject, String level);

    /**
     * Makes a link that opens the resource at a level until it expires, as the person of the
     * request.
     *
     * @param expires when the link stops working; the installation may set a longest validity
     * @throws IllegalArgumentException when the level is not declared for the type, the type does not
     *     accept links, or the expiry is in the past or too far
     * @throws AccessDeniedException when the person of the request may not share the resource
     * @throws NoSuchElementException when the resource is not registered in the organization
     */
    SharedLink createLink(ResourceRef resource, String level, Instant expires);

    /**
     * Revokes a grant, or a link with its grant, as the person of the request. Revoking a grant that
     * no longer exists does nothing.
     *
     * @throws AccessDeniedException when the person of the request may not share the resource
     */
    void revoke(UUID grant);

    /** The grants of a resource, links included, as the sharing dialog shows them. */
    List<Grant> grants(ResourceRef resource);

    /** The highest level the request has on a resource, or empty when it has none. */
    Optional<String> level(ResourceRef resource);

    /** The highest level a person of the organization has on a resource, or empty when they have none. */
    Optional<String> level(UUID person, ResourceRef resource);

    /** Whether the request has at least a level on a resource. */
    boolean allows(ResourceRef resource, String level);

    /** Whether a person of the organization has at least a level on a resource. */
    boolean allows(UUID person, ResourceRef resource, String level);

    /**
     * Refuses the request unless it has at least a level on a resource.
     *
     * @throws AccessDeniedException when it has a lower level ({@code 403}), or none at all, in
     *     which case the exception is {@link AccessDeniedException#concealed() concealed} and the
     *     kernel answers {@code 404}
     */
    default void require(ResourceRef resource, String level) {
        if (!allows(resource, level)) {
            boolean seen = level(resource).isPresent();
            throw new AccessDeniedException("You need the level " + level + " on " + resource, !seen);
        }
    }

    /**
     * The identifiers of the resources of one type on which the request has at least a level, for
     * the list pages of an extension, which filter their query with them.
     */
    Set<String> visible(String extension, String type, String level);

    /** The identifiers of the resources of one type on which a person has at least a level. */
    Set<String> visible(UUID person, String extension, String type, String level);
}
