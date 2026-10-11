// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

import io.quarkus.hibernate.validator.runtime.jaxrs.ResteasyReactiveViolationException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;

/**
 * Replaces the default Quarkus response for invalid REST parameters with an RFC 9457 problem
 * detail, so that every error of the API has the same shape.
 */
@Provider
public class RestValidationExceptionMapper implements ExceptionMapper<ResteasyReactiveViolationException> {

    @Override
    public Response toResponse(ResteasyReactiveViolationException exception) {
        return ValidationExceptionMapper.toProblem(exception);
    }
}
