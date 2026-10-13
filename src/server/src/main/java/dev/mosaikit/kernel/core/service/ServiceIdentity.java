// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.service;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Arrays;
import java.util.Collection;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * A service identity (MK-124): a caller of the APIs of extensions that is not a person, such as a
 * gateway or a map server. It has keys of its own, the APIs it may call, the endpoints of the kernel
 * meant for services it may call, and the organizations it may name; no organization, no password,
 * no shell.
 */
@Entity
@Table(name = "service_identity")
public class ServiceIdentity {

    @Id
    private UUID id;

    @Column(nullable = false, updatable = false)
    private String name;

    @Column(nullable = false)
    private String description;

    /** Comma-separated names of the APIs of extensions. */
    @Column(nullable = false)
    private String apis;

    /** Comma-separated endpoints of the kernel meant for services. */
    @Column(nullable = false)
    private String endpoints;

    /** Comma-separated identifiers of the organizations it may name. */
    @Column(nullable = false)
    private String organizations;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "created_by", nullable = false, updatable = false)
    private String createdBy;

    /** Required by JPA. */
    protected ServiceIdentity() {}

    ServiceIdentity(String name, String description, Grants grants, Instant now, String createdBy) {
        this.id = UUID.randomUUID();
        this.name = Objects.requireNonNull(name, "name");
        this.description = description == null ? "" : description;
        this.apis = join(grants.apis());
        this.endpoints = join(grants.endpoints());
        this.organizations = joinIds(grants.organizations());
        this.createdAt = now;
        this.createdBy = Objects.requireNonNull(createdBy, "createdBy");
    }

    public UUID getId() {
        return id;
    }

    public String getName() {
        return name;
    }

    public String getDescription() {
        return description;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public String getCreatedBy() {
        return createdBy;
    }

    /** What the identity may call and name. */
    public Grants grants() {
        return new Grants(
                split(apis),
                split(endpoints),
                split(organizations).stream().map(UUID::fromString).collect(Collectors.toUnmodifiableSet()));
    }

    static String join(Collection<String> names) {
        return names.stream().sorted().collect(Collectors.joining(","));
    }

    static String joinIds(Collection<UUID> ids) {
        return join(ids.stream().map(UUID::toString).toList());
    }

    private static Set<String> split(String names) {
        return Arrays.stream(names.split(","))
                .map(String::strip)
                .filter(name -> !name.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
    }

    /**
     * What a service identity may call and name.
     *
     * @param apis the names of the APIs of extensions, as in {@code /api/v1/ext/<api>/}
     * @param endpoints the endpoints of the kernel meant for services ({@link ServiceRegistry#ENDPOINTS})
     * @param organizations the organizations it may name with {@code X-Mosaikit-Organization}
     */
    public record Grants(Set<String> apis, Set<String> endpoints, Set<UUID> organizations) {
        public Grants {
            apis = Set.copyOf(apis);
            endpoints = Set.copyOf(endpoints);
            organizations = Set.copyOf(organizations);
        }
    }
}
