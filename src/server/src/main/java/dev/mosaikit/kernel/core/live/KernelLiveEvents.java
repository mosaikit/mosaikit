// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.live;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.live.LiveEvents;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/** The real-time events of plugins and of the kernel (MK-031), for the organization of the request. */
@ApplicationScoped
public class KernelLiveEvents implements LiveEvents {

    private final LiveBus bus;
    private final CurrentOrganization organization;

    public KernelLiveEvents(LiveBus bus, CurrentOrganization organization) {
        this.bus = bus;
        this.organization = organization;
    }

    @Override
    public void publish(String topic, Object data) {
        bus.publish(new LiveEvent(topic, organization.require(), null, data));
    }

    @Override
    public void publishTo(String topic, Object data, Collection<UUID> accounts) {
        bus.publish(new LiveEvent(topic, organization.require(), List.copyOf(accounts), data));
    }
}
