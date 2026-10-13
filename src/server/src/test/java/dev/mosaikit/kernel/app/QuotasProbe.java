// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.app;

import dev.mosaikit.kernel.api.quota.Quota;
import dev.mosaikit.kernel.api.quota.Quotas;
import dev.mosaikit.kernel.api.resource.ResourceRef;
import io.quarkus.security.Authenticated;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;

/**
 * Stands for the Java code of an extension that meters what organizations use (MK-076): it calls the
 * {@link Quotas} bean as an extension does, naming the extension in every call. A refusal of a quota
 * goes out as the extension lets it, and the kernel answers it.
 */
@Path("/api/v1/test/quotas")
@Produces(MediaType.APPLICATION_JSON)
@Authenticated
public class QuotasProbe {

    private final Quotas quotas;

    public QuotasProbe(Quotas quotas) {
        this.quotas = quotas;
    }

    @POST
    @Path("/check/{extension}/{measure}")
    public Response check(
            @PathParam("extension") String extension,
            @PathParam("measure") String measure,
            @QueryParam("amount") long amount) {
        return answer(() -> view(quotas.check(extension, measure, amount)));
    }

    @POST
    @Path("/consume/{extension}/{measure}")
    public Response consume(
            @PathParam("extension") String extension,
            @PathParam("measure") String measure,
            @QueryParam("amount") long amount) {
        return answer(() -> view(quotas.consume(extension, measure, amount)));
    }

    @POST
    @Path("/set/{extension}/{measure}")
    public Response set(
            @PathParam("extension") String extension,
            @PathParam("measure") String measure,
            @QueryParam("amount") long amount) {
        return answer(() -> view(quotas.set(extension, measure, amount)));
    }

    @PUT
    @Path("/space/{extension}/{type}/{id}")
    public Response space(
            @PathParam("extension") String extension,
            @PathParam("type") String type,
            @PathParam("id") String id,
            @QueryParam("bytes") long bytes) {
        return answer(() -> {
            quotas.reportSpace(new ResourceRef(extension, type, id), bytes);
            return null;
        });
    }

    private static Map<String, Object> view(Quota quota) {
        Map<String, Object> view = new LinkedHashMap<>();
        view.put("measure", quota.measure());
        view.put("unit", quota.unit());
        view.put("period", quota.period());
        view.put("limit", quota.limit().isPresent() ? quota.limit().getAsLong() : null);
        view.put("used", quota.used());
        view.put("requested", quota.requested());
        view.put("fits", quota.fits());
        view.put("remaining", quota.remaining().isPresent() ? quota.remaining().getAsLong() : null);
        return view;
    }

    private static Response answer(Supplier<Object> call) {
        try {
            Object result = call.get();
            return result == null
                    ? Response.noContent().build()
                    : Response.ok(result).build();
        } catch (IllegalArgumentException e) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(List.of(String.valueOf(e.getMessage())))
                    .build();
        }
    }
}
