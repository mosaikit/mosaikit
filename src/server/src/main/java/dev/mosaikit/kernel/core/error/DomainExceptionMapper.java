// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.util.List;

/** Renders domain failures as problem details. */
@Provider
public class DomainExceptionMapper implements ExceptionMapper<DomainException> {

    @Override
    public Response toResponse(DomainException exception) {
        var problem = new ProblemDetail(
                "about:blank",
                exception.title(),
                exception.status(),
                exception.getMessage(),
                exception instanceof InvalidInputException invalid ? invalid.fieldErrors() : List.of());
        return Response.status(exception.status())
                .type(ProblemDetail.MEDIA_TYPE)
                .entity(problem)
                .build();
    }
}
