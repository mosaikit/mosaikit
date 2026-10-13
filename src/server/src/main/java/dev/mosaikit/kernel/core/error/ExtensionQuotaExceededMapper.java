// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

import dev.mosaikit.kernel.api.quota.QuotaExceededException;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.util.List;

/**
 * An action of an extension refused by a quota of the organization (MK-076): {@code 403 Quota
 * exceeded}, the same problem detail as a refusal of the kernel, naming the limit.
 */
@Provider
public class ExtensionQuotaExceededMapper implements ExceptionMapper<QuotaExceededException> {

    @Override
    public Response toResponse(QuotaExceededException exception) {
        var quota = exception.quota();
        var problem = new ProblemDetail(
                "about:blank",
                "Quota exceeded",
                403,
                exception.getMessage(),
                List.of(),
                new dev.mosaikit.kernel.core.error.QuotaExceededException.Quota(
                        quota.measure(),
                        quota.unit(),
                        quota.period(),
                        quota.limit().orElse(Long.MAX_VALUE),
                        quota.used(),
                        quota.requested()));
        return Response.status(403)
                .type(ProblemDetail.MEDIA_TYPE)
                .entity(problem)
                .build();
    }
}
