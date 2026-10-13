// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

import dev.mosaikit.kernel.api.secrets.SecretsUnavailableException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.util.List;

/**
 * The credentials cannot be read, from the code of an extension: the installation has no master key,
 * or a credential does not decrypt (MK-062). The message names no value.
 */
@Provider
public class SecretsUnavailableExceptionMapper implements ExceptionMapper<SecretsUnavailableException> {

    @Override
    public Response toResponse(SecretsUnavailableException exception) {
        var problem = new ProblemDetail("about:blank", "Service Unavailable", 503, exception.getMessage(), List.of());
        return Response.status(503)
                .type(ProblemDetail.MEDIA_TYPE)
                .entity(problem)
                .build();
    }
}
