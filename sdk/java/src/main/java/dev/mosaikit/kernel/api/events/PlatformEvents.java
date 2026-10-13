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
     * An organization was deleted; payload {@code slug}. Reserved: the kernel does not delete
     * organizations yet, and raises it when it does.
     */
    String ORGANIZATION_DELETED = "organization.deleted";

    /** An extension was turned on in an organization (its apps, MK-030); payload {@code extension}. */
    String EXTENSION_ENABLED = "extension.enabled";

    /** An extension was turned off in an organization (all its apps, MK-030); payload {@code extension}. */
    String EXTENSION_DISABLED = "extension.disabled";

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
