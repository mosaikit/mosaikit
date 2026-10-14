// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.events.PlatformEvent;
import dev.mosaikit.kernel.api.events.PlatformEvents;
import jakarta.enterprise.context.ApplicationScoped;
import java.sql.SQLException;
import java.util.Set;

/**
 * Stands for the Java code of an extension that translates grants, teams and permissions into the
 * rules of another server (MK-085): it subscribes to the events of changes of access and records them.
 */
@ApplicationScoped
public class AccessEventsProbe extends EventSubscribersProbe.Recording {

    static final String NAME = "access";

    @Override
    public String extension() {
        return EventSubscribersProbe.EVENTS;
    }

    @Override
    public String name() {
        return NAME;
    }

    @Override
    public Set<String> types() {
        return Set.of(
                PlatformEvents.SHARING_GRANTED,
                PlatformEvents.SHARING_CHANGED,
                PlatformEvents.SHARING_REVOKED,
                PlatformEvents.TEAM_MEMBER_ADDED,
                PlatformEvents.TEAM_MEMBER_CHANGED,
                PlatformEvents.TEAM_MEMBER_REMOVED,
                PlatformEvents.PERMISSIONS_PROFILE_CHANGED,
                PlatformEvents.PERMISSIONS_PROFILE_ASSIGNED,
                PlatformEvents.PERMISSIONS_TEAM_CHANGED,
                PlatformEvents.PERMISSIONS_EXCEPTION_CHANGED);
    }

    @Override
    public void handle(PlatformEvent event) throws SQLException {
        record(event, null);
    }
}
