// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.presence;

import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.core.events.PlatformEventLog;
import dev.mosaikit.kernel.core.live.LiveBus;
import dev.mosaikit.kernel.core.live.LiveEvent;
import dev.mosaikit.kernel.core.live.LiveTopics;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;

/**
 * Tells that an extension became active or inactive in an organization (MK-133): an event of the
 * platform for the backends of extensions (MK-085), and an event of the real-time channel on the topic
 * {@value LiveTopics#EXTENSIONS} for the pages open in the organization (MK-031). Both leave in the
 * transaction of the caller, only if it commits.
 */
@ApplicationScoped
public class PresenceNotices {

    /** Why an extension became active or inactive, as the payloads name it. */
    public enum Reason {
        INSTALLED(true),
        UPDATED(true),
        ENABLED(true),
        REMOVED(false),
        INCOMPATIBLE(false),
        DISABLED(false);

        private final boolean active;

        Reason(boolean active) {
            this.active = active;
        }

        /** Whether the extension is active after the change. */
        public boolean active() {
            return active;
        }

        /** The name in payloads, such as {@code installed}. */
        public String text() {
            return name().toLowerCase(java.util.Locale.ROOT);
        }
    }

    /**
     * A change of the presence of an extension in an organization.
     *
     * @param extension its identifier
     * @param version the version it has now, or the one it had when it is no longer active
     * @param previousVersion the version before an update, or {@code null}
     * @param reason why it changed
     */
    public record Change(String extension, String version, String previousVersion, Reason reason) {

        public Change {
            Objects.requireNonNull(extension, "extension");
            Objects.requireNonNull(version, "version");
            Objects.requireNonNull(reason, "reason");
        }

        /** The payload of the event of the platform and of the real-time channel. */
        Map<String, Object> payload() {
            Map<String, Object> payload = new LinkedHashMap<>();
            payload.put("extension", extension);
            payload.put("version", version);
            payload.put("active", reason.active());
            payload.put("reason", reason.text());
            if (previousVersion != null) {
                payload.put("previousVersion", previousVersion);
            }
            return payload;
        }
    }

    private final PlatformEventLog events;
    private final LiveBus live;

    public PresenceNotices(PlatformEventLog events, LiveBus live) {
        this.events = events;
        this.live = live;
    }

    /** Tells the backends and the open pages of an organization about a change. */
    public void tell(UUID organization, Change change) {
        Map<String, Object> payload = change.payload();
        events.raise(
                organization,
                change.reason().active() ? PlatformEvents.EXTENSION_ACTIVATED : PlatformEvents.EXTENSION_DEACTIVATED,
                payload);
        // Every person of the organization, guests too: which extensions are active is no secret there.
        live.publish(new LiveEvent(LiveTopics.EXTENSIONS, organization, null, payload));
    }
}
