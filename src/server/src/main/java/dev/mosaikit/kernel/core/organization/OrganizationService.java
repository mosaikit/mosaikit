// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.core.config.KernelConfig;
import dev.mosaikit.kernel.core.data.KernelWrites;
import dev.mosaikit.kernel.core.error.ConflictException;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.error.ResourceNotFoundException;
import dev.mosaikit.kernel.core.events.PlatformEventLog;
import dev.mosaikit.kernel.core.identity.RealmProvisioning;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Event;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;

/** Creates, looks up and deletes organizations. */
@KernelWrites
@ApplicationScoped
@Transactional
public class OrganizationService {

    private final Organizations organizations;
    private final EmailDomains emailDomains;
    private final Event<IdentityChanged> identityChanged;
    private final RealmProvisioning realms;
    private final PlatformEventLog events;
    private final EntityManager entityManager;
    private final Duration removalRetention;
    private final Clock clock;

    public OrganizationService(
            Organizations organizations,
            EmailDomains emailDomains,
            Event<IdentityChanged> identityChanged,
            RealmProvisioning realms,
            PlatformEventLog events,
            EntityManager entityManager,
            KernelConfig config,
            Clock clock) {
        this.organizations = organizations;
        this.emailDomains = emailDomains;
        this.identityChanged = identityChanged;
        this.realms = realms;
        this.events = events;
        this.entityManager = entityManager;
        this.removalRetention =
                OrganizationRemovals.retention(config.organizations().removalRetention());
        this.clock = clock;
    }

    /** Creates an organization with a unique slug. */
    public OrganizationView create(CreateOrganizationRequest request) {
        return create(request, List.of());
    }

    /**
     * Creates an organization with a unique slug and, when the request asks for federation, its
     * Keycloak realm (MK-018). The realm is created last and deleted again if the organization
     * cannot be saved, so that neither exists without the other.
     *
     * @param redirectUris addresses of the kernel UI, for the client of a new realm
     */
    public OrganizationView create(CreateOrganizationRequest request, List<String> redirectUris) {
        String slug = request.slug().toLowerCase(Locale.ROOT);
        if (organizations.countBySlug(slug) > 0) {
            throw new ConflictException("An organization with slug '" + slug + "' already exists.");
        }
        if (deletedWithSlug(slug)) {
            // Its data are kept until it is removed (MK-130): the slug stays taken until then.
            throw new ConflictException("The slug '" + slug + "' belongs to a deleted organization, until it is"
                    + " removed after the retention of the installation.");
        }
        var organization =
                new Organization(slug, request.name().trim(), request.selfRegistration(), Instant.now(clock));
        SignInPolicy signIn = Optional.ofNullable(request.signIn())
                .orElse(request.federation() == null ? SignInPolicy.PASSWORD : SignInPolicy.REALM);
        if (request.federation() == null && signIn.allowsRealm()) {
            throw new ConflictException("An organization without a realm signs in with a password: create it with"
                    + " \"federation\", or set its realm first.");
        }
        organization.setSignIn(signIn);
        organizations.insert(organization);
        identityChanged.fire(new IdentityChanged(organization.getId()));
        // MK-085: extensions prepare what they keep for the organization; delivered once it commits.
        events.raise(
                organization.getId(),
                PlatformEvents.ORGANIZATION_CREATED,
                Map.of("slug", organization.getSlug(), "name", organization.getName()));
        if (request.federation() == null) {
            return OrganizationView.of(organization, List.of());
        }
        FederationRequest federation = request.federation();
        List<String> domains = saveIdentity(organization, Optional.of(slug), federation.emailDomains());
        Optional<RealmProvisioning.Manager> manager = Optional.ofNullable(federation.administrator())
                .map(admin -> new RealmProvisioning.Manager(admin.email(), admin.firstName(), admin.lastName()));
        Optional<String> password = realms.create(slug, organization.getName(), redirectUris, manager);
        try {
            organizations.update(organization);
        } catch (RuntimeException e) {
            realms.undo(slug);
            throw e;
        }
        InitialAdministrator administrator = manager.flatMap(found -> password.map(
                        secret -> new InitialAdministrator(found.email().toLowerCase(Locale.ROOT), secret)))
                .orElse(null);
        return OrganizationView.of(organization, domains, administrator);
    }

    /** Sets the realm and the email domains with which an organization signs in (MK-012). */
    public OrganizationView updateIdentity(String slug, UpdateIdentityRequest request) {
        Organization organization = require(slug);
        var realm = Optional.ofNullable(request.realm()).map(String::trim).filter(value -> !value.isEmpty());
        // Setting a realm on an organization that signed in with passwords keeps passwords working.
        SignInPolicy current = organization.getSignIn() == SignInPolicy.PASSWORD
                ? SignInPolicy.PASSWORD_OR_REALM
                : organization.getSignIn();
        SignInPolicy signIn = realm.isEmpty()
                ? SignInPolicy.PASSWORD
                : Optional.ofNullable(request.signIn()).orElse(current);
        if (realm.isEmpty() && request.signIn() != null && request.signIn().allowsRealm()) {
            throw new ConflictException("Sign-in through a realm needs a realm.");
        }
        organization.setSignIn(signIn);
        List<String> domains = saveIdentity(organization, realm, request.emailDomains());
        organizations.update(organization);
        return OrganizationView.of(organization, domains);
    }

    /** Checks and saves the realm and the email domains of an organization. */
    private List<String> saveIdentity(Organization organization, Optional<String> realm, Set<String> requested) {
        realm.flatMap(organizations::findByIdentityRealm)
                .filter(other -> !other.getId().equals(organization.getId()))
                .ifPresent(other -> {
                    throw new ConflictException("Realm '" + realm.get() + "' is used by another organization.");
                });
        var domains = requested.stream()
                .map(domain -> domain.trim().toLowerCase(Locale.ROOT))
                .collect(Collectors.toCollection(TreeSet::new));
        for (String domain : domains) {
            if (emailDomains.countOwnedByOthers(domain, organization.getId()) > 0) {
                throw new ConflictException("Email domain '" + domain + "' belongs to another organization.");
            }
        }
        organization.setIdentityRealm(realm);
        emailDomains.deleteByOrganizationId(organization.getId());
        domains.forEach(domain -> emailDomains.insert(new EmailDomain(domain, organization.getId())));
        identityChanged.fire(new IdentityChanged(organization.getId()));
        return List.copyOf(domains);
    }

    /** Lists every organization, ordered by name. */
    public List<OrganizationView> list() {
        var domains = emailDomains.findAllOrdered().stream()
                .collect(Collectors.groupingBy(
                        EmailDomain::getOrganizationId,
                        Collectors.mapping(EmailDomain::getDomain, Collectors.toList())));
        return organizations.findAllOrderedByName().stream()
                .map(organization ->
                        OrganizationView.of(organization, domains.getOrDefault(organization.getId(), List.of())))
                .toList();
    }

    /** Finds an organization by slug. */
    public OrganizationView get(String slug) {
        Organization organization = require(slug);
        return OrganizationView.of(organization, domainsOf(organization));
    }

    private List<String> domainsOf(Organization organization) {
        return emailDomains.findByOrganizationId(organization.getId()).stream()
                .map(EmailDomain::getDomain)
                .toList();
    }

    /**
     * Deletes an organization (MK-130): it appears nowhere from now on and opens nothing, its email
     * domains are released, and the extensions subscribed to {@code organization.deleted} are told,
     * once this commits. Its data, and those of its extensions, stay until {@code removableFrom},
     * when {@link OrganizationRemovals} removes them. The caller ends the sessions of its people.
     *
     * @param confirmation the slug of the organization, written again by the administrator
     * @param actor who deletes it
     * @throws InvalidInputException when the confirmation does not name the organization
     */
    public Deleted delete(String slug, String confirmation, String actor) {
        Organization organization = require(slug);
        if (confirmation == null || !organization.getSlug().equals(confirmation.strip())) {
            throw new InvalidInputException(List.of("confirmation: write the slug of the organization, '"
                    + organization.getSlug() + "', to delete it"));
        }
        Instant now = Instant.now(clock);
        Instant removableFrom = now.plus(removalRetention);
        int marked = entityManager
                .createNativeQuery("update {h-schema}organization set deleted_at = :now, deleted_by = :actor,"
                        + " removable_from = :removableFrom where id = :id and deleted_at is null")
                .setParameter("now", Timestamp.from(now))
                .setParameter("actor", actor)
                .setParameter("removableFrom", Timestamp.from(removableFrom))
                .setParameter("id", organization.getId())
                .executeUpdate();
        if (marked == 0) {
            throw new ResourceNotFoundException("No organization with slug '" + slug + "'.");
        }
        entityManager.detach(organization);
        List<String> domains = domainsOf(organization);
        emailDomains.deleteByOrganizationId(organization.getId());
        identityChanged.fire(new IdentityChanged(organization.getId()));
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("slug", organization.getSlug());
        payload.put("name", organization.getName());
        payload.put("removableFrom", removableFrom.toString());
        events.raise(organization.getId(), PlatformEvents.ORGANIZATION_DELETED, payload);
        return new Deleted(
                organization.getId(), organization.getSlug(), organization.getName(), now, removableFrom, domains);
    }

    /**
     * A deleted organization.
     *
     * @param deletedAt when it was deleted
     * @param removableFrom from when its data may be removed
     * @param emailDomains the email domains it had, released
     */
    public record Deleted(
            UUID id, String slug, String name, Instant deletedAt, Instant removableFrom, List<String> emailDomains) {}

    private boolean deletedWithSlug(String slug) {
        Number found = (Number) entityManager
                .createNativeQuery("select count(*) from {h-schema}organization where slug = :slug"
                        + " and deleted_at is not null")
                .setParameter("slug", slug)
                .getSingleResult();
        return found.longValue() > 0;
    }

    /** Every organization entity, ordered by name. */
    public List<Organization> all() {
        return organizations.findAllOrderedByName();
    }

    /** Returns the organization entity or fails with a not-found problem. */
    public Organization require(String slug) {
        return organizations
                .findBySlug(slug.toLowerCase(Locale.ROOT))
                .orElseThrow(() -> new ResourceNotFoundException("No organization with slug '" + slug + "'."));
    }
}
