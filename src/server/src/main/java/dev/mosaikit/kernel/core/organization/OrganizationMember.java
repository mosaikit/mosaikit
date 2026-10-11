// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Arrays;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Collectors;

/**
 * The membership of an account in an organization (MK-017): the roles of the person in that
 * organization and, once the person signed in through the realm of the organization, the subject
 * of the person in that realm.
 */
@Entity
@Table(name = "organization_member")
public class OrganizationMember {

    @Id
    private UUID id;

    @Column(name = "account_id", nullable = false)
    private UUID accountId;

    @Column(name = "organization_id", nullable = false)
    private UUID organizationId;

    /** Comma-separated kernel roles in the organization. */
    @Column(nullable = false)
    private String roles;

    /** Subject ({@code sub}) of the person in the realm of the organization. */
    @Column(name = "identity_subject")
    private String identitySubject;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /** Required by JPA. */
    protected OrganizationMember() {}

    public OrganizationMember(UUID accountId, UUID organizationId, Set<String> roles, Instant createdAt) {
        this.id = UUID.randomUUID();
        this.accountId = Objects.requireNonNull(accountId, "accountId");
        this.organizationId = Objects.requireNonNull(organizationId, "organizationId");
        this.roles = join(roles);
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public UUID getId() {
        return id;
    }

    public UUID getAccountId() {
        return accountId;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    /** Kernel roles of the person in the organization. */
    public Set<String> getRoles() {
        return Arrays.stream(roles.split(","))
                .map(String::trim)
                .filter(role -> !role.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
    }

    /** Replaces the roles, for example as granted by the realm of the organization. */
    public void replaceRoles(Set<String> newRoles) {
        this.roles = join(newRoles);
    }

    public Optional<String> getIdentitySubject() {
        return Optional.ofNullable(identitySubject);
    }

    /** Links the membership to the subject of the person in the realm of the organization. */
    public void linkIdentity(String subject) {
        this.identitySubject = Objects.requireNonNull(subject, "subject");
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    private static String join(Set<String> roles) {
        return String.join(",", new TreeSet<>(roles));
    }
}
