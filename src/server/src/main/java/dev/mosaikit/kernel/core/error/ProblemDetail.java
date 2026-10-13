// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;

/**
 * An error response following <a href="https://www.rfc-editor.org/rfc/rfc9457">RFC 9457</a>.
 *
 * @param type URI reference identifying the problem type
 * @param title short summary of the problem type
 * @param status HTTP status code
 * @param detail explanation specific to this occurrence, telling the caller what to do
 * @param errors field-level errors, present for validation problems
 */
@JsonInclude(JsonInclude.Include.NON_EMPTY)
public record ProblemDetail(String type, String title, int status, String detail, List<FieldError> errors) {

    /** Media type of problem details. */
    public static final String MEDIA_TYPE = "application/problem+json";

    /** A problem on a single request field. */
    public record FieldError(String field, String message) {}

    public ProblemDetail {
        errors = errors == null ? List.of() : List.copyOf(errors);
    }
}
