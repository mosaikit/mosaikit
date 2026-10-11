// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.sample.estimates;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import io.quarkus.security.Authenticated;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;

/** Estimates of the activities of the organization of the request (MK-020). */
@Path("/api/v1/p/sample-estimates/estimates")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@Authenticated
public class EstimateResource {

    /** Request to set an estimate. */
    public record NewEstimate(
            @NotNull @DecimalMin("0") @DecimalMax("10000") BigDecimal hours) {}

    /** An activity with its estimate, if it has one. */
    public record EstimateView(UUID activityId, String title, boolean done, BigDecimal hours) {}

    private final Estimates estimates;
    private final CurrentOrganization organization;

    public EstimateResource(Estimates estimates, CurrentOrganization organization) {
        this.estimates = estimates;
        this.organization = organization;
    }

    /** Every activity of the organization with its estimate: a join made in code, not in SQL. */
    @GET
    @Transactional
    public List<EstimateView> list() {
        Map<UUID, BigDecimal> hours = estimates.all().stream()
                .collect(Collectors.toMap(Estimate::getActivityId, Estimate::getHours, (a, b) -> a));
        return estimates.activities().stream()
                .map(activity -> view(activity, hours.get(activity.getId())))
                .toList();
    }

    @GET
    @Path("/{activityId}")
    @Transactional
    public EstimateView get(@PathParam("activityId") UUID activityId) {
        ActivitySummary activity = activity(activityId);
        return view(
                activity,
                estimates.findByActivityId(activityId).map(Estimate::getHours).orElse(null));
    }

    @PUT
    @Path("/{activityId}")
    @Transactional
    public EstimateView put(@PathParam("activityId") UUID activityId, @Valid @NotNull NewEstimate request) {
        ActivitySummary activity = activity(activityId);
        Instant now = Instant.now();
        estimates
                .findByActivityId(activityId)
                .ifPresentOrElse(
                        estimate -> {
                            estimate.change(request.hours(), now);
                            estimates.update(estimate);
                        },
                        () -> estimates.insert(new Estimate(activityId, organization.require(), request.hours(), now)));
        return view(activity, request.hours());
    }

    /** The activity, if the organization of the request has it: the contract view says so. */
    private ActivitySummary activity(UUID id) {
        return estimates.findActivity(id).orElseThrow(() -> new NotFoundException("No activity " + id));
    }

    private static EstimateView view(ActivitySummary activity, BigDecimal hours) {
        return new EstimateView(activity.getId(), activity.getTitle(), activity.isDone(), hours);
    }
}
