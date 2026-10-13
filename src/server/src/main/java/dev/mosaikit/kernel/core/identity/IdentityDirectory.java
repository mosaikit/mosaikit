// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.organization.EmailDomain;
import dev.mosaikit.kernel.core.organization.EmailDomains;
import dev.mosaikit.kernel.core.organization.IdentityChanged;
import dev.mosaikit.kernel.core.organization.Organization;
import dev.mosaikit.kernel.core.organization.Organizations;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.context.control.ActivateRequestContext;
import jakarta.enterprise.event.Observes;
import jakarta.enterprise.event.TransactionPhase;
import jakarta.transaction.Transactional;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

/**
 * Identity settings of every organization, kept in memory for the time set by {@code
 * mosaikit.identity.cache-ttl} so that routing a sign-in does not query the database. Changes
 * made through this instance take effect at once; changes made by other instances of the kernel
 * within the cache time.
 */
@ApplicationScoped
public class IdentityDirectory {

    private record Snapshot(IdentityRouting routing, Instant loadedAt) {}

    private final Organizations organizations;
    private final EmailDomains emailDomains;
    private final KernelConfig.Identity config;
    private final Clock clock;
    private final AtomicReference<Snapshot> snapshot = new AtomicReference<>();

    public IdentityDirectory(Organizations organizations, EmailDomains emailDomains, KernelConfig config, Clock clock) {
        this.organizations = organizations;
        this.emailDomains = emailDomains;
        this.config = config.identity();
        this.clock = clock;
    }

    /** The routing, if it is loaded and fresh; never blocks. */
    public Optional<IdentityRouting> cached() {
        Snapshot current = snapshot.get();
        if (current == null || current.loadedAt().plus(config.cacheTtl()).isBefore(Instant.now(clock))) {
            return Optional.empty();
        }
        return Optional.of(current.routing());
    }

    /** The routing, loaded from the database when the cached one is missing or stale. Blocks. */
    public IdentityRouting routing() {
        return cached().orElseGet(this::load);
    }

    /** Drops the cached routing, after the identity settings of an organization changed. */
    public void invalidate() {
        snapshot.set(null);
    }

    void onIdentityChanged(@Observes(during = TransactionPhase.AFTER_COMPLETION) IdentityChanged event) {
        invalidate();
    }

    @ActivateRequestContext
    @Transactional
    IdentityRouting load() {
        var domains = emailDomains.findAllOrdered().stream()
                .collect(Collectors.groupingBy(
                        EmailDomain::getOrganizationId,
                        Collectors.mapping(EmailDomain::getDomain, Collectors.toSet())));
        var identities = organizations.findAllOrderedByName().stream()
                .map(organization -> identity(organization, domains.getOrDefault(organization.getId(), Set.of())))
                .toList();
        var routing = new IdentityRouting(config.keycloakUrl(), config.domain(), identities);
        snapshot.set(new Snapshot(routing, Instant.now(clock)));
        return routing;
    }

    private static OrganizationIdentity identity(Organization organization, Set<String> domains) {
        UUID id = organization.getId();
        return new OrganizationIdentity(
                id, organization.getSlug(), organization.getIdentityRealm(), domains, organization.getSignIn());
    }
}
