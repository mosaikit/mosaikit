// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.events;

import java.util.Set;

/**
 * Subscribes the Java code of an extension to events of the platform (MK-085). Implement it in an
 * {@code @ApplicationScoped} bean; the kernel finds every such bean at start.
 *
 * <pre>{@code
 * @ApplicationScoped
 * public class PrepareOrganization implements PlatformEventSubscriber {
 *     @Inject Resources resources;
 *
 *     public String extension() { return "dev.example.notes"; }
 *     public Set<String> types() { return Set.of(PlatformEvents.ORGANIZATION_CREATED); }
 *     public void handle(PlatformEvent event) {
 *         resources.register(new ResourceRef("dev.example.notes", "folder", "inbox"), INBOX);
 *     }
 * }
 * }</pre>
 *
 * <p>The kernel calls {@link #handle} once for each event of a matching type raised after the
 * subscriber was installed, in a transaction of its own and in the organization of the event, without
 * a person: {@code CurrentOrganization} is that organization, row-level security shows its data only,
 * and what the handler stores or registers through the beans of the kernel belongs to the
 * organization, recorded in the audit log with the extension as actor and the channel {@code JOB}.
 * An event of an organization reaches the subscribers of that organization only, and not those of an
 * extension whose apps the organization turned off, except the event that turns that extension
 * itself off or on.
 *
 * <p><strong>At least once.</strong> When {@link #handle} throws, its transaction rolls back and the
 * kernel gives the event again later, waiting longer each time, up to the most attempts of the
 * installation. An event raised while the kernel is stopped, or while the subscriber fails, is
 * delivered when it is back. So an event may come twice, for example when the kernel stops right
 * after the handler: make the handler idempotent, such as registering by a fixed identifier or
 * keeping {@link PlatformEvent#id()} in the same transaction as the work. Events come roughly in the
 * order they were raised, not strictly when some were retried.
 */
public interface PlatformEventSubscriber {

    /** The identifier of the extension of this subscriber, which must be active. */
    String extension();

    /**
     * The name of this subscriber within its extension, when it has several: lowercase letters,
     * digits and '-'. The kernel keeps what was delivered to each subscriber by this name, so keep it
     * stable across versions.
     */
    default String name() {
        return "default";
    }

    /**
     * The types of event it receives, such as {@value PlatformEvents#FILE_STORED} or
     * {@code dev.example.notes:note.created}.
     */
    Set<String> types();

    /**
     * Handles one event. Throw to have it given again later.
     *
     * @throws Exception when the event was not handled
     */
    void handle(PlatformEvent event) throws Exception;
}
