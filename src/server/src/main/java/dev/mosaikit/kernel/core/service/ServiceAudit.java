// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.service;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * The audit of service identities (MK-124), through the channel {@link AuditEvent.Channel#SERVICE}
 * (MK-059): the first call of each identity to each API in an hour, and every refused call, with the
 * key, the method and the path, also during authentication, outside of any request. The secret never
 * is. Creating identities and keys, changing grants and revoking keys are recorded by the resource of
 * the platform administrators.
 */
@ApplicationScoped
@ActivateRequestContext
public class ServiceAudit {

    /** A call of a service identity, accepted: the first of each hour for each API. */
    public static final String USED = "service.used";

    /** A call of a service identity, refused. */
    public static final String REFUSED = "service.refused";

    private final AuditLog audit;

    public ServiceAudit(AuditLog audit) {
        this.audit = audit;
    }

    /** The prefix of the actor of every entry written by a service identity. */
    static final String ACTOR_START = "service:";

    /** The actor of the entries of a service identity: {@code service:<name>}. */
    public static String actor(String name) {
        return ACTOR_START + name;
    }

    /**
     * The service identity of an audited call.
     *
     * @param organization the organization the call named, or {@code null}
     */
    public record Caller(UUID serviceId, String name, UUID keyId, String prefix, UUID organization) {

        static Caller of(ServiceRegistry.Active active, UUID organization) {
            return new Caller(active.serviceId(), active.name(), active.keyId(), active.prefix(), organization);
        }
    }

    /** The first call of an identity to an API, or to an endpoint of the kernel, in an hour. */
    public void used(Caller caller, String target, String method, String path) {
        append(USED, AuditEvent.Outcome.SUCCEEDED, caller, target, method, path, null);
    }

    /**
     * A call refused.
     *
     * @param reason why: {@code revoked}, {@code not-granted} or {@code organization}
     */
    public void refused(Caller caller, String target, String method, String path, String reason) {
        append(REFUSED, AuditEvent.Outcome.DENIED, caller, target, method, path, reason);
    }

    private void append(
            String action,
            AuditEvent.Outcome outcome,
            Caller caller,
            String target,
            String method,
            String path,
            String reason) {
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("service", caller.serviceId().toString());
        detail.put("key", caller.keyId().toString());
        if (target != null) {
            detail.put("api", target);
        }
        if (method != null) {
            detail.put("method", method);
        }
        if (path != null) {
            detail.put("path", path);
        }
        if (reason != null) {
            detail.put("reason", reason);
        }
        audit.append(
                AuditEvent.Channel.SERVICE,
                actor(caller.name()),
                Optional.ofNullable(caller.organization()),
                action,
                caller.prefix(),
                outcome,
                detail);
    }
}
