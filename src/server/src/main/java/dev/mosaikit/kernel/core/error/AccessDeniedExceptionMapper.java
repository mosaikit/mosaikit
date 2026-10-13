// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

import dev.mosaikit.kernel.api.permission.AccessDeniedException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.util.List;

/**
 * A person who lacks a permission (MK-056) or a level on a resource (MK-055), also refused by the
 * code of an extension: {@code 403}, or {@code 404} when the existence of the object is concealed.
 */
@Provider
public class AccessDeniedExceptionMapper implements ExceptionMapper<AccessDeniedException> {

    @Override
    public Response toResponse(AccessDeniedException exception) {
        int status = exception.concealed() ? 404 : 403;
        var problem = new ProblemDetail(
                "about:blank",
                exception.concealed() ? "Resource not found" : "Forbidden",
                status,
                exception.concealed() ? "The resource does not exist." : exception.getMessage(),
                List.of());
        return Response.status(status)
                .type(ProblemDetail.MEDIA_TYPE)
                .entity(problem)
                .build();
    }
}
