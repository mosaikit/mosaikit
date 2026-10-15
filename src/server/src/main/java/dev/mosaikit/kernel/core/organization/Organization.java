// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.hibernate.annotations.SQLRestriction;

/**
 * An organization: the unit of isolation for users, data and enabled extensions. A deleted
 * organization (MK-130) is left out of every query of this entity, so that it appears nowhere and
 * opens nothing; only {@link OrganizationRemovals} and the deletion read it, with SQL of their own.
 */
@Entity
@Table(name = "organization")
@SQLRestriction("deleted_at is null")
public class Organization {

    @Id
    private UUID id;

    @Column(nullable = false, unique = true, length = 63)
    private String slug;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(name = "self_registration", nullable = false)
    private boolean selfRegistration;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /** Keycloak realm of the organization; empty when it signs in with local accounts only. */
    @Column(name = "identity_realm", unique = true, length = 63)
    private String identityRealm;

    /** How the members sign in to act on the data of the organization (MK-017). */
    @Enumerated(EnumType.STRING)
    @Column(name = "sign_in", nullable = false, length = 20)
    private SignInPolicy signIn = SignInPolicy.PASSWORD;

    /** When a platform administrator suspended it: its members sign in to it by no means (MK-072). */
    @Column(name = "suspended_at")
    private Instant suspendedAt;

    /** The username of the administrator who suspended it. */
    @Column(name = "suspended_by", length = 255)
    private String suspendedBy;

    /** Why it was suspended, as the administrator wrote it. */
    @Column(name = "suspension_reason", length = 500)
    private String suspensionReason;

    /** Required by JPA. */
    protected Organization() {}

    public Organization(String slug, String name, boolean selfRegistration, Instant createdAt) {
        this.id = UUID.randomUUID();
        this.slug = Objects.requireNonNull(slug, "slug");
        this.name = Objects.requireNonNull(name, "name");
        this.selfRegistration = selfRegistration;
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
    }

    public UUID getId() {
        return id;
    }

    public String getSlug() {
        return slug;
    }

    public String getName() {
        return name;
    }

    public boolean isSelfRegistration() {
        return selfRegistration;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Optional<String> getIdentityRealm() {
        return Optional.ofNullable(identityRealm);
    }

    public SignInPolicy getSignIn() {
        return signIn;
    }

    public void setSignIn(SignInPolicy signIn) {
        this.signIn = Objects.requireNonNull(signIn, "signIn");
    }

    /** Whether a platform administrator suspended it (MK-072). */
    public boolean isSuspended() {
        return suspendedAt != null;
    }

    public Optional<Instant> getSuspendedAt() {
        return Optional.ofNullable(suspendedAt);
    }

    public Optional<String> getSuspendedBy() {
        return Optional.ofNullable(suspendedBy);
    }

    public Optional<String> getSuspensionReason() {
        return Optional.ofNullable(suspensionReason);
    }

    /** Suspends it; one already suspended keeps when, by whom and why it was suspended first. */
    public void suspend(Instant at, String by, String reason) {
        if (suspendedAt == null) {
            this.suspendedAt = Objects.requireNonNull(at, "at");
            this.suspendedBy = Objects.requireNonNull(by, "by");
            this.suspensionReason = reason;
        }
    }

    /** Lets its members sign in to it again. */
    public void reactivate() {
        this.suspendedAt = null;
        this.suspendedBy = null;
        this.suspensionReason = null;
    }

    /** Sets the Keycloak realm of the organization, or removes it with an empty value. */
    public void setIdentityRealm(Optional<String> realm) {
        this.identityRealm = realm.orElse(null);
    }
}
