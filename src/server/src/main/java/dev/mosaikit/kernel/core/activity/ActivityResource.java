// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.activity;

import dev.mosaikit.kernel.api.live.Notifications;
import dev.mosaikit.kernel.core.account.AccountDirectory;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.eclipse.microprofile.openapi.annotations.Operation;
import org.eclipse.microprofile.openapi.annotations.tags.Tag;

/** The activity feed of the signed-in person, and the notifications of frontend plugins (MK-038). */
@Path("/api/v1/notifications")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
@Tag(name = "Activity")
public class ActivityResource {

    private final ActivityService activity;
    private final AccountDirectory accounts;
    private final SecurityIdentity identity;

    public ActivityResource(ActivityService activity, AccountDirectory accounts, SecurityIdentity identity) {
        this.activity = activity;
        this.accounts = accounts;
        this.identity = identity;
    }

    /**
     * A notification sent by a frontend plugin.
     *
     * @param plugin the plugin that sends it
     * @param to the email addresses of people of the organization
     */
    public record Sent(
            @NotBlank String plugin,
            @NotNull @Size(min = 1, max = 500) List<@NotBlank String> to,
            @NotBlank String kind,
            @NotBlank String title,
            String body,
            String link) {}

    @GET
    @Operation(summary = "Get the activity feed of the signed-in person in the organization, newest first")
    public Map<String, Object> feed() {
        UUID account = me();
        return Map.of("unread", activity.unread(account), "notifications", activity.feed(account));
    }

    @POST
    @Operation(
            summary = "Notify people of the organization, as a plugin",
            description = "The people who turned the kind off, or who are not in the organization, receive nothing.")
    public Response send(@Valid @NotNull Sent sent) {
        activity.sendToAddresses(
                sent.plugin(),
                sent.to(),
                new Notifications.Notification(sent.kind(), sent.title(), sent.body(), sent.link()));
        return Response.accepted().build();
    }

    @POST
    @Path("/{id}/read")
    @Operation(summary = "Mark a notification of the signed-in person as read")
    public Response read(@PathParam("id") UUID id) {
        activity.markRead(me(), id);
        return Response.noContent().build();
    }

    @POST
    @Path("/read")
    @Operation(summary = "Mark every notification of the signed-in person in the organization as read")
    public Response readAll() {
        activity.markAllRead(me());
        return Response.noContent().build();
    }

    private UUID me() {
        return accounts.idOf(identity.getPrincipal().getName()).orElseThrow();
    }
}
