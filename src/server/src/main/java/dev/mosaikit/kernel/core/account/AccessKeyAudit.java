// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * The audit of personal access keys (MK-060): every request made with a key, accepted or refused,
 * is recorded with the key, the method and the path, also during authentication, outside of any
 * request, through the channel {@link AuditEvent.Channel#API_KEY} (MK-059). The secret never is.
 */
@ApplicationScoped
@ActivateRequestContext
public class AccessKeyAudit {

    /** A request made with a key, accepted by authentication. */
    public static final String USED = "account.access-key.used";

    /** A request made with a key, refused. */
    public static final String REFUSED = "account.access-key.refused";

    private final AuditLog audit;

    public AccessKeyAudit(AuditLog audit) {
        this.audit = audit;
    }

    /**
     * The key of an audited request.
     *
     * @param name the name of the key, or {@code null} when not known
     */
    public record Key(UUID id, UUID organizationId, String prefix, String name) {

        static Key of(AccessKeyRegistry.Active active) {
            return new Key(active.id(), active.organizationId(), active.prefix(), active.name());
        }
    }

    /** A request accepted with a key. */
    public void used(String actor, Key key, String method, String path) {
        append(USED, AuditEvent.Outcome.SUCCEEDED, actor, key, method, path, null);
    }

    /**
     * A request refused because of its key.
     *
     * @param reason why: {@code revoked}, {@code expired}, {@code suspended}, {@code not-a-member},
     *     {@code read-only} or {@code not-with-a-key}
     */
    public void refused(String actor, Key key, String method, String path, String reason) {
        append(REFUSED, AuditEvent.Outcome.DENIED, actor, key, method, path, reason);
    }

    private void append(
            String action,
            AuditEvent.Outcome outcome,
            String actor,
            Key key,
            String method,
            String path,
            String reason) {
        Map<String, Object> detail = new LinkedHashMap<>();
        detail.put("key", key.id().toString());
        if (key.name() != null) {
            detail.put("name", key.name());
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
                AuditEvent.Channel.API_KEY,
                actor,
                Optional.ofNullable(key.organizationId()),
                action,
                key.prefix(),
                outcome,
                detail);
    }
}
