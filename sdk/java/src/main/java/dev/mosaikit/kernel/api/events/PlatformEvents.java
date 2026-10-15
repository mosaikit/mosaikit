// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.events;

import java.util.Map;

/**
 * Raises events of an extension for the subscribers on the server (MK-085), and names the events of
 * the kernel. The kernel provides this bean to extensions.
 *
 * <p>An event is written in the transaction of the caller, in the organization of the request (or of
 * the event a subscriber is handling): it is delivered only if that transaction commits, and then
 * even if the kernel stops right after. The calling extension names itself, as with
 * {@code Notifications.send}; the type is recorded as {@code <extension>:<name>}, such as
 * {@code dev.example.notes:note.created}, which is the type subscribers declare.
 */
public interface PlatformEvents {

    /** The source of the events of the kernel. */
    String KERNEL = "kernel";

    /** An organization was created; payload {@code slug}, {@code name}. */
    String ORGANIZATION_CREATED = "organization.created";

    /**
     * An organization was deleted (MK-130); payload {@code slug}, {@code name} and
     * {@code removableFrom}, the time from which the kernel removes its data. Release what is kept
     * outside the database and the files of the kernel for the organization (workspaces of other
     * servers, scheduled work); its rows and its files stay until then, and the kernel removes them.
     */
    String ORGANIZATION_DELETED = "organization.deleted";

    /** An extension was turned on in an organization (its apps, MK-030); payload {@code extension}. */
    String EXTENSION_ENABLED = "extension.enabled";

    /** An extension was turned off in an organization (all its apps, MK-030); payload {@code extension}. */
    String EXTENSION_DISABLED = "extension.disabled";

    /**
     * An extension became active in an organization (MK-133): installed, or able to run again, updated
     * to another version, or turned on. Payload {@code extension}, {@code version}, {@code active}
     * ({@code true}), {@code reason} ({@code installed}, {@code updated} or {@code enabled}), and
     * {@code previousVersion} when it was updated. Raised in every organization where it is active, for
     * any extension: subscribe to it to take up what another extension offers.
     */
    String EXTENSION_ACTIVATED = "extension.activated";

    /**
     * An extension stopped being active in an organization (MK-133): removed, no longer able to run (an
     * extension it requires went away, or the kernel changed), or turned off. Payload
     * {@code extension}, {@code version} (the one it had), {@code active} ({@code false}) and
     * {@code reason} ({@code removed}, {@code incompatible} or {@code disabled}). Raised in every
     * organization where it was active.
     */
    String EXTENSION_DEACTIVATED = "extension.deactivated";

    /**
     * A file was stored (MK-041); payload {@code extension}, {@code file}, {@code name},
     * {@code contentType}, {@code size}, and {@code team} and {@code resource} when it has them.
     */
    String FILE_STORED = "file.stored";

    /** A file was deleted (MK-041); payload as {@link #FILE_STORED}. */
    String FILE_DELETED = "file.deleted";

    /**
     * A resource was registered (MK-054); payload {@code extension}, {@code type}, {@code id},
     * {@code title}, and {@code owner} when a person owns it.
     */
    String RESOURCE_REGISTERED = "resource.registered";

    /** A registered resource was removed (MK-054); payload {@code extension}, {@code type}, {@code id}. */
    String RESOURCE_REMOVED = "resource.removed";

    /**
     * A resource was shared with a subject (MK-055); payload {@code extension}, {@code type},
     * {@code id} of the resource, {@code grant}, {@code subject} ({@code person}, {@code group},
     * {@code organization}, {@code public} or {@code link}), {@code subjectId} for a person (the
     * account) or a group (the team), and {@code level}.
     */
    String SHARING_GRANTED = "sharing.granted";

    /**
     * The level of a grant changed, because the resource was shared again with the same subject
     * (MK-055); payload as {@link #SHARING_GRANTED}, and {@code previousLevel}.
     */
    String SHARING_CHANGED = "sharing.changed";

    /**
     * A grant or a link was revoked (MK-055); payload as {@link #SHARING_GRANTED}. A link that
     * expires raises nothing: its subject carries its expiry.
     */
    String SHARING_REVOKED = "sharing.revoked";

    /**
     * A person was added to a team or to a group of a team (MK-032), also its first owner when it was
     * created; payload {@code team}, {@code account}, {@code role} ({@code owner}, {@code member} or
     * {@code guest}), and {@code parent} for a group. Never for a chat.
     */
    String TEAM_MEMBER_ADDED = "team.member.added";

    /**
     * The role of a person in a team or group changed (MK-032); payload as {@link #TEAM_MEMBER_ADDED},
     * and {@code previousRole}.
     */
    String TEAM_MEMBER_CHANGED = "team.member.changed";

    /**
     * A person left a team or group, or was removed from it, also when the team was deleted (MK-032);
     * payload as {@link #TEAM_MEMBER_ADDED}, with the role they had.
     */
    String TEAM_MEMBER_REMOVED = "team.member.removed";

    /**
     * A permission profile was created, changed or deleted (MK-056); payload {@code profile},
     * {@code change} ({@code created}, {@code changed} or {@code deleted}), {@code defaultForRole}
     * (empty when it is the default of no role), {@code added} and {@code removed}, the qualified
     * permissions it gained and lost.
     */
    String PERMISSIONS_PROFILE_CHANGED = "permissions.profile.changed";

    /**
     * A profile was assigned to a member, or taken back so that the default of their role applies
     * (MK-056); payload {@code account} and {@code profile}, empty for the default.
     */
    String PERMISSIONS_PROFILE_ASSIGNED = "permissions.profile.assigned";

    /**
     * A permission was granted to a team, or revoked from it (MK-056); payload {@code team},
     * {@code permission} (qualified, {@code <extension>:<permission>}) and {@code granted}, a boolean.
     */
    String PERMISSIONS_TEAM_CHANGED = "permissions.team.changed";

    /**
     * A personal exception was granted to a person, or revoked (MK-056); payload {@code account},
     * {@code permission} (qualified) and {@code granted}, a boolean.
     */
    String PERMISSIONS_EXCEPTION_CHANGED = "permissions.exception.changed";

    /** At most this many characters of the payload as JSON: say what happened, not the whole of it. */
    int MAX_PAYLOAD = 8192;

    /**
     * Raises an event of the calling extension in the organization of the request.
     *
     * @param extension identifier of the calling extension, which must be active
     * @param name what happened, such as {@code note.created}: lowercase letters, digits, '.' and '-',
     *     starting with a letter
     * @param payload what subscribers need, written as JSON, at most {@value #MAX_PAYLOAD} characters;
     *     never secrets. Empty or {@code null} for none
     * @throws IllegalArgumentException when the extension is not active, or the name or the payload are
     *     not valid
     * @throws dev.mosaikit.kernel.api.context.NoOrganizationException when the request has no
     *     organization
     */
    void raise(String extension, String name, Map<String, ?> payload);
}
