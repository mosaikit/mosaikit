// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.sample.activities;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import io.quarkus.security.Authenticated;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** Activities of the organization of the request (MK-020). */
@Path("/api/v1/p/sample-activities/activities")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
public class ActivityResource {

    /** Request to create an activity. */
    public record NewActivity(@NotBlank @Size(max = 200) String title) {}

    /** An activity as returned by the API. */
    public record ActivityView(UUID id, String title, boolean done, Instant createdAt) {

        static ActivityView of(Activity activity) {
            return new ActivityView(activity.getId(), activity.getTitle(), activity.isDone(), activity.getCreatedAt());
        }
    }

    private final Activities activities;
    private final CurrentOrganization organization;

    public ActivityResource(Activities activities, CurrentOrganization organization) {
        this.activities = activities;
        this.organization = organization;
    }

    @GET
    @Transactional
    public List<ActivityView> list() {
        return activities.all().stream().map(ActivityView::of).toList();
    }

    @POST
    @Transactional
    public Response create(@Valid @NotNull NewActivity request) {
        Activity activity = new Activity(organization.require(), request.title().strip(), Instant.now());
        activities.insert(activity);
        return Response.status(Response.Status.CREATED)
                .entity(ActivityView.of(activity))
                .build();
    }

    @POST
    @Path("/{id}/completion")
    @Transactional
    public ActivityView complete(@PathParam("id") UUID id) {
        Activity activity = activities.findById(id).orElseThrow(() -> new NotFoundException("No activity " + id));
        activity.complete();
        activities.update(activity);
        return ActivityView.of(activity);
    }
}
