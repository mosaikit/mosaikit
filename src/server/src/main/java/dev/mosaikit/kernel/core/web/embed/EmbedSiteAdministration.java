// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.web.embed;

import dev.mosaikit.kernel.core.audit.AuditEvent;
import dev.mosaikit.kernel.core.audit.AuditLog;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.web.csp.ExternalOrigins;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * The sites on which an organization lets its views be shown in an iframe (MK-100), for its
 * administrators: listed, added and removed here, every change in the audit log of the organization.
 * A site is an origin {@code https://host[:port]}, or {@code http://} for a test site, with at most
 * one leading {@code *.} for the sub-domains of a name.
 */
@ApplicationScoped
@Transactional
public class EmbedSiteAdministration {

    /** At most this many sites per organization: a list of sites, not of every page of the web. */
    static final int MAX_SITES = 50;

    /** A site, when and by whom it was added. */
    public record SiteView(String origin, Instant addedAt, String addedBy) {}

    /** A site to add. */
    public record SiteRequest(String origin) {}

    private final EmbedSites sites;
    private final AuditLog audit;
    private final EntityManager entityManager;
    private final Clock clock;

    public EmbedSiteAdministration(EmbedSites sites, AuditLog audit, EntityManager entityManager, Clock clock) {
        this.sites = sites;
        this.audit = audit;
        this.entityManager = entityManager;
        this.clock = clock;
    }

    /** The sites of an organization, by origin. */
    public List<SiteView> list(UUID organization) {
        asOwner();
        return sites.of(organization).stream()
                .map(EmbedSiteAdministration::view)
                .toList();
    }

    /**
     * Adds a site.
     *
     * @throws InvalidInputException when it is not a site the kernel accepts
     * @throws ConflictException when it is already listed, or the list is full
     */
    public SiteView add(UUID organization, SiteRequest request, String actor) {
        String origin = normalize(request == null ? null : request.origin());
        asOwner();
        if (sites.find(organization, origin).isPresent()) {
            throw new ConflictException(origin + " is already listed.");
        }
        if (sites.of(organization).size() >= MAX_SITES) {
            throw new ConflictException("An organization lists at most " + MAX_SITES + " sites.");
        }
        EmbedSite added = new EmbedSite(organization, origin, actor, Instant.now(clock));
        sites.insert(added);
        record(organization, actor, "organization.embed-site.added", origin);
        return view(added);
    }

    /** Removes a site. */
    public void remove(UUID organization, String value, String actor) {
        String origin = normalize(value);
        asOwner();
        EmbedSite found = sites.find(organization, origin)
                .orElseThrow(() -> new ResourceNotFoundException(origin + " is not a listed site."));
        sites.delete(found);
        record(organization, actor, "organization.embed-site.removed", origin);
    }

    /**
     * The site in its normal form: an origin as for the content security policy (MK-128), with the
     * scheme {@code https} or {@code http} only, as {@code frame-ancestors} compares the page around.
     */
    static String normalize(String origin) {
        return ExternalOrigins.normalize(origin)
                .filter(found -> found.startsWith("https://") || found.startsWith("http://"))
                .orElseThrow(() -> new InvalidInputException(List.of("origin must be https://host[:port] (or http://"
                        + " for a test site), without a path; one leading *. may stand for the sub-domains of a name"
                        + " of two labels or more, such as https://*.example.org")));
    }

    private static SiteView view(EmbedSite site) {
        return new SiteView(site.getOrigin(), site.getAddedAt(), site.getAddedBy());
    }

    private void record(UUID organization, String actor, String action, String origin) {
        audit.append(
                actor,
                Optional.of(organization),
                action,
                "embed-site/" + origin,
                AuditEvent.Outcome.SUCCEEDED,
                Map.of("origin", origin));
    }

    /**
     * Runs the rest of the transaction as the owner of the tables (ADR-0018): the member role of
     * requests has no right on the sites, so that the SQL of an extension cannot widen them.
     */
    private void asOwner() {
        entityManager
                .createNativeQuery("select set_config('role', 'none', true)")
                .getSingleResult();
    }
}
