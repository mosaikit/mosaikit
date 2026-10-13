// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.util.Arrays;
import java.util.Comparator;

/** Renders Bean Validation failures raised outside REST parameters as a problem detail. */
@Provider
public class ValidationExceptionMapper implements ExceptionMapper<ConstraintViolationException> {

    private static final int BAD_REQUEST = 400;

    @Override
    public Response toResponse(ConstraintViolationException exception) {
        return toProblem(exception);
    }

    /** Builds a 400 problem detail listing every invalid field. */
    static Response toProblem(ConstraintViolationException exception) {
        var errors = exception.getConstraintViolations().stream()
                .map(ValidationExceptionMapper::toFieldError)
                .sorted(Comparator.comparing(ProblemDetail.FieldError::field))
                .toList();
        var problem = new ProblemDetail(
                "about:blank", "Invalid request", BAD_REQUEST, "Correct the listed fields and retry.", errors);
        return Response.status(BAD_REQUEST)
                .type(ProblemDetail.MEDIA_TYPE)
                .entity(problem)
                .build();
    }

    private static ProblemDetail.FieldError toFieldError(ConstraintViolation<?> violation) {
        String path = violation.getPropertyPath().toString();
        // REST parameters are reported as "method.parameter.field": keep only the field path.
        String[] parts = path.split("\\.");
        String field = parts.length > 2 ? String.join(".", Arrays.copyOfRange(parts, 2, parts.length)) : path;
        return new ProblemDetail.FieldError(field, violation.getMessage());
    }
}
