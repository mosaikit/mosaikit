// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web.csp;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The external origins of the content security policy for platform administrators (MK-128): those
 * of the configuration of the installation, which only the configuration changes, and those that
 * administrators add and remove here. Every change is in the audit log of the platform.
 */
@ApplicationScoped
@Transactional
public class OriginAdministration {

    /** Where an origin of the policy comes from. */
    public enum Source {
        /** {@code mosaikit.content-security-policy.allowed-origins}. */
        CONFIGURATION,
        /** Added by a platform administrator. */
        ADMINISTRATION
    }

    /** An origin of the policy; {@code addedAt} and {@code addedBy} for those of the administrators. */
    public record OriginView(String origin, Source source, Instant addedAt, String addedBy) {}

    /**
     * The origins and the policy.
     *
     * @param enabled whether the kernel sends the policy (in production)
     * @param policy the header the kernel sends, once the change is read
     */
    public record PolicyView(boolean enabled, String policy, List<OriginView> origins) {}

    /** An origin to add. */
    public record OriginRequest(String origin) {}

    private final AllowedOrigins origins;
    private final ContentSecurityPolicy policy;
    private final AuditLog audit;
    private final EntityManager entityManager;
    private final Clock clock;

    public OriginAdministration(
            AllowedOrigins origins,
            ContentSecurityPolicy policy,
            AuditLog audit,
            EntityManager entityManager,
            Clock clock) {
        this.origins = origins;
        this.policy = policy;
        this.audit = audit;
        this.entityManager = entityManager;
        this.clock = clock;
    }

    /** The origins of the configuration, then those of the administrators. */
    public List<OriginView> list() {
        asOwner();
        List<OriginView> result = new ArrayList<>();
        policy.configured().forEach(origin -> result.add(new OriginView(origin, Source.CONFIGURATION, null, null)));
        origins.list()
                .forEach(origin -> result.add(new OriginView(
                        origin.getOrigin(), Source.ADMINISTRATION, origin.getAddedAt(), origin.getAddedBy())));
        return result;
    }

    /**
     * Adds an origin.
     *
     * @throws InvalidInputException when it is not an origin the policy accepts
     * @throws ConflictException when the policy already allows it
     */
    public OriginView add(OriginRequest request, String actor) {
        String origin = normalize(request == null ? null : request.origin());
        asOwner();
        if (policy.configured().contains(origin) || origins.find(origin).isPresent()) {
            throw new ConflictException(origin + " is already allowed.");
        }
        AllowedOrigin added = new AllowedOrigin(origin, actor, Instant.now(clock));
        origins.insert(added);
        record(actor, "content-security-policy.origin-added", origin);
        return new OriginView(origin, Source.ADMINISTRATION, added.getAddedAt(), actor);
    }

    /**
     * Removes an origin that an administrator added.
     *
     * @throws ConflictException for an origin of the configuration, which only the configuration removes
     */
    public void remove(String value, String actor) {
        String origin = normalize(value);
        asOwner();
        Optional<AllowedOrigin> found = origins.find(origin);
        if (found.isEmpty()) {
            if (policy.configured().contains(origin)) {
                throw new ConflictException(origin + " is allowed by mosaikit.content-security-policy.allowed-origins:"
                        + " remove it from the configuration.");
            }
            throw new ResourceNotFoundException(origin + " is not an allowed origin.");
        }
        origins.delete(found.get());
        record(actor, "content-security-policy.origin-removed", origin);
    }

    private static String normalize(String origin) {
        return ExternalOrigins.normalize(origin)
                .orElseThrow(() -> new InvalidInputException(List.of("origin must be scheme://host[:port], with the"
                        + " scheme https, wss, http or ws, without a path; one leading *. may stand for the"
                        + " sub-domains of a name of two labels or more, such as https://*.tiles.example.org")));
    }

    private void record(String actor, String action, String origin) {
        audit.append(
                actor,
                Optional.empty(),
                action,
                "origin/" + origin,
                AuditEvent.Outcome.SUCCEEDED,
                Map.of("origin", origin));
    }

    /**
     * Runs the rest of the transaction as the owner of the tables (ADR-0018): the table of the origins
     * belongs to no organization, and the member role of requests has no right on it.
     */
    private void asOwner() {
        entityManager
                .createNativeQuery("select set_config('role', 'none', true)")
                .getSingleResult();
    }
}
