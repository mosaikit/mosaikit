// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.events.PlatformEvent;
import dev.mosaikit.kernel.api.events.PlatformEventSubscriber;
import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.api.extension.ExtensionPresence;
import io.quarkus.security.Authenticated;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Stands for the Java code of an extension that asks whether another one is active (MK-133): through
 * the {@link ExtensionPresence} bean in a request, and through the events of the platform it
 * subscribes to.
 */
@Path("/api/v1/test/presence")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class PresenceProbe {

    /** The extension of the subscriber, installed by {@link ExtensionPresenceTest}. */
    static final String EXTENSION = ExtensionDependencyTest.VIEWER;

    /** What the subscriber received, in order. */
    static final List<Received> RECEIVED = new CopyOnWriteArrayList<>();

    /** An event as the subscriber saw it, with what the bean answered in its handler. */
    record Received(PlatformEvent event, UUID currentOrganization, boolean activeInHandler) {}

    private final ExtensionPresence presence;

    public PresenceProbe(ExtensionPresence presence) {
        this.presence = presence;
    }

    @GET
    @Path("/{extension}")
    public Map<String, Object> ask(@PathParam("extension") String extension) {
        Map<String, Object> answer = new HashMap<>();
        answer.put("active", presence.isActive(extension));
        answer.put("version", presence.version(extension).map(Object::toString).orElse(null));
        return answer;
    }

    /** The subscriber of the extension: told when another extension becomes active or inactive. */
    @ApplicationScoped
    public static class Watcher implements PlatformEventSubscriber {

        @Inject
        ExtensionPresence presence;

        @Inject
        CurrentOrganization organization;

        @Override
        public String extension() {
            return EXTENSION;
        }

        @Override
        public String name() {
            return "presence";
        }

        @Override
        public Set<String> types() {
            return Set.of(PlatformEvents.EXTENSION_ACTIVATED, PlatformEvents.EXTENSION_DEACTIVATED);
        }

        @Override
        public void handle(PlatformEvent event) {
            RECEIVED.add(
                    new Received(event, organization.id().orElse(null), presence.isActive(event.text("extension"))));
        }
    }
}
