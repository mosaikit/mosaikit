// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

import dev.mosaikit.kernel.api.context.NoOrganizationException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.util.List;

/** A request that needs an organization and has none, also from the code of a plugin (MK-017). */
@Provider
public class NoOrganizationExceptionMapper implements ExceptionMapper<NoOrganizationException> {

    @Override
    public Response toResponse(NoOrganizationException exception) {
        var problem = new ProblemDetail("about:blank", "Forbidden", 403, exception.getMessage(), List.of());
        return Response.status(403)
                .type(ProblemDetail.MEDIA_TYPE)
                .entity(problem)
                .build();
    }
}
