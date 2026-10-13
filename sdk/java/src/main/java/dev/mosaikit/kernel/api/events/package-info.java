// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
/**
 * Events of the platform delivered to the Java code of extensions on the server (MK-085). The kernel
 * raises events when an organization is created, when an extension is turned on or off in an
 * organization, when a file is stored or deleted and when a resource is registered or removed;
 * extensions raise their own with {@link dev.mosaikit.kernel.api.events.PlatformEvents}. An extension
 * subscribes with a bean that implements {@link dev.mosaikit.kernel.api.events.PlatformEventSubscriber}.
 * Unlike the real-time channel to the pages ({@code LiveEvents}), delivery is durable: at least
 * once, retried, and after a restart.
 */
package dev.mosaikit.kernel.api.events;
