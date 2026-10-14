// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.permission;

import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/**
 * Who holds a permission of an extension in the organization of the request (MK-056, ADR-0038), for
 * the Java code of an extension that translates its permissions into the rules of another server,
 * such as the roles of a map server. {@link Permissions} answers for the person of the request; this
 * bean answers for the organization, with the same rules:
 *
 * <ul>
 *   <li>the administrators of the organization hold every permission;
 *   <li>a member holds what their profile (theirs, or the default of their role), their teams and
 *       their personal exceptions grant;
 *   <li>a guest holds only what their teams and their exceptions grant;
 *   <li>a permission the extension does not declare, or of an extension whose apps are all off for
 *       the organization (MK-030), is held by nobody.
 * </ul>
 *
 * <p>The calling extension names itself, as with {@link Permissions}, and must be active. Every
 * method acts on the organization of the request, or of the event a subscriber is handling (MK-085).
 * When the person of the request is a guest of the organization, the answer is limited to the teams
 * where they are and the people of those teams; a request opened through a shared link gets nobody.
 * To follow the changes without polling, subscribe to the events of permissions of
 * {@code PlatformEvents}. The kernel provides this bean to extensions.
 */
public interface PermissionHolders {

    /**
     * The holders of a permission.
     *
     * @param permission the qualified permission
     * @param people the accounts of the people of the organization that hold it now, for any reason:
     *     administrators, profile, teams and exceptions
     * @param teams the teams and groups granted the permission, whose people hold it whatever their
     *     role in the team; their people are also in {@code people}
     */
    record Holders(PermissionId permission, Set<UUID> people, Set<UUID> teams) {

        public Holders {
            Objects.requireNonNull(permission, "permission");
            people = Set.copyOf(people);
            teams = Set.copyOf(teams);
        }

        /** Whether a person holds the permission. */
        public boolean holds(UUID account) {
            return people.contains(account);
        }
    }

    /**
     * Who holds a permission of the calling extension in the organization of the request.
     *
     * @param extension identifier of the calling extension, which declares the permission
     * @param permission name of the permission in the manifest, such as {@code create-dashboard}
     * @return the holders; nobody when the extension does not declare the permission or its apps are
     *     off for the organization
     * @throws IllegalArgumentException when {@code extension} is not an active extension
     * @throws dev.mosaikit.kernel.api.context.NoOrganizationException when the request has no
     *     organization
     */
    Holders of(String extension, String permission);
}
