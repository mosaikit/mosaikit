// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.events.PlatformEvent;
import dev.mosaikit.kernel.api.events.PlatformEventSubscriber;
import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import dev.mosaikit.kernel.api.resource.Trash;
import io.quarkus.security.Authenticated;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Supplier;

/**
 * Stands for the Java code of an extension that moves its resources to the trash (MK-095), such as a
 * file manager: it calls the {@link Trash} bean naming the extension, and its subscriber records what
 * the kernel tells it when a resource is trashed, restored or deleted for good.
 */
@Path("/api/v1/test/trash/{extension}/{type}")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class TrashProbe {

    private final Trash trash;

    public TrashProbe(Trash trash) {
        this.trash = trash;
    }

    @POST
    @Path("/{id}")
    public Response trash(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        return answer(() -> refs(trash.trash(new ResourceRef(extension, type, id))));
    }

    @POST
    @Path("/{id}/restore")
    public Response restore(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        return answer(() -> refs(trash.restore(new ResourceRef(extension, type, id))));
    }

    @GET
    @Path("/{id}")
    public Response contains(
            @PathParam("extension") String extension, @PathParam("type") String type, @PathParam("id") String id) {
        return answer(() -> trash.contains(new ResourceRef(extension, type, id)));
    }

    @GET
    public Response trashed(@PathParam("extension") String extension, @PathParam("type") String type) {
        return answer(() -> trash.trashed(extension, type));
    }

    private static List<String> refs(List<ResourceRef> refs) {
        return refs.stream().map(ref -> ref.type() + "/" + ref.id()).toList();
    }

    private static Response answer(Supplier<Object> call) {
        try {
            return Response.ok(call.get()).build();
        } catch (NoSuchElementException e) {
            return Response.status(Response.Status.NOT_FOUND).build();
        } catch (IllegalArgumentException e) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(List.of(String.valueOf(e.getMessage())))
                    .build();
        }
    }

    /** What the extension of the tests was told of its resources. */
    @ApplicationScoped
    public static class Told implements PlatformEventSubscriber {

        private final List<PlatformEvent> received = new CopyOnWriteArrayList<>();

        @Override
        public String extension() {
            return TrashTest.EXTENSION;
        }

        @Override
        public String name() {
            return "trash";
        }

        @Override
        public Set<String> types() {
            return Set.of(
                    PlatformEvents.RESOURCE_TRASHED, PlatformEvents.RESOURCE_RESTORED, PlatformEvents.RESOURCE_PURGED);
        }

        @Override
        public void handle(PlatformEvent event) {
            // A file manager keeps only the events of its own resources.
            if (TrashTest.EXTENSION.equals(event.text("extension"))) {
                received.add(event);
            }
        }

        /** The events of a type received for a resource. */
        List<PlatformEvent> of(String type, String id) {
            return received.stream()
                    .filter(event -> event.type().equals(type) && id.equals(event.text("id")))
                    .toList();
        }
    }
}
