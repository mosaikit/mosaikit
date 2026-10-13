// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.events.PlatformEvents;
import io.quarkus.security.Authenticated;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.Map;

/**
 * Stands for the Java code of an extension that raises its own events of the platform (MK-085), in
 * the organization of the request: its REST resources call {@link PlatformEvents} as an extension does.
 */
@Path("/api/v1/test/events/{extension}/{name}")
@Authenticated
public class EventsProbe {

    private final PlatformEvents events;

    public EventsProbe(PlatformEvents events) {
        this.events = events;
    }

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Transactional
    public Response raise(
            @PathParam("extension") String extension, @PathParam("name") String name, Map<String, Object> payload) {
        try {
            events.raise(extension, name, payload);
            return Response.noContent().build();
        } catch (IllegalArgumentException e) {
            return Response.status(Response.Status.BAD_REQUEST).build();
        }
    }
}
