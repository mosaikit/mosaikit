// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.account;

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
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * The account of a person: one per email address, whatever the organizations the person belongs
 * to (MK-017). A local account has a password; an account created at the first sign-in through a
 * realm has none. The roles of the account are the roles of the platform ({@code platform-admin});
 * the roles in each organization belong to its membership.
 */
@Entity
@Table(name = "user_account")
public class UserAccount {

    @Id
    private UUID id;

    /** Login name: the lowercase email address. */
    @Column(nullable = false, unique = true, length = 254)
    private String username;

    @Column(name = "display_name", nullable = false, length = 120)
    private String displayName;

    /** Hash of the local password; empty for accounts that sign in through a realm only. */
    @Column(name = "password_hash")
    private String passwordHash;

    /** Comma-separated roles of the platform. */
    @Column(nullable = false)
    private String roles;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    /** When the person proved to own the address; empty until a self-registered person confirms it. */
    @Column(name = "email_confirmed_at")
    private Instant emailConfirmedAt;

    /** The personal settings, as JSON (MK-027). */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String preferences = "{}";

    /** Required by JPA. */
    protected UserAccount() {}

    /** A local account, with a password. */
    public UserAccount(
            String username, String displayName, String passwordHash, Set<String> platformRoles, Instant createdAt) {
        this(username, displayName, platformRoles, createdAt);
        this.passwordHash = Objects.requireNonNull(passwordHash, "passwordHash");
    }

    private UserAccount(String username, String displayName, Set<String> platformRoles, Instant createdAt) {
        this.id = UUID.randomUUID();
        this.username = Objects.requireNonNull(username, "username");
        this.displayName = Objects.requireNonNull(displayName, "displayName");
        this.roles = String.join(",", new TreeSet<>(platformRoles));
        this.createdAt = Objects.requireNonNull(createdAt, "createdAt");
        this.emailConfirmedAt = createdAt;
    }

    /**
     * An account without password: for a person who signs in through the realm of an organization,
     * or who is added to an organization before signing in.
     */
    public static UserAccount withoutPassword(String username, String displayName, Instant createdAt) {
        return new UserAccount(username, displayName, Set.of(), createdAt);
    }

    /** The personal settings, as JSON. */
    public String getPreferences() {
        return preferences;
    }

    public void setPreferences(String preferences) {
        this.preferences = preferences;
    }

    /** A self-registered person must confirm the address before signing in. */
    public void requireConfirmation() {
        this.emailConfirmedAt = null;
    }

    /** The person opened the link sent to the address. */
    public void confirmEmail(Instant now) {
        this.emailConfirmedAt = Objects.requireNonNull(now, "now");
    }

    /** Whether the address is confirmed; only confirmed accounts sign in. */
    public boolean isEmailConfirmed() {
        return emailConfirmedAt != null;
    }

    public UUID getId() {
        return id;
    }

    public String getUsername() {
        return username;
    }

    public String getDisplayName() {
        return displayName;
    }

    /** Hash of the local password; empty for accounts that sign in through a realm only. */
    public Optional<String> getPasswordHash() {
        return Optional.ofNullable(passwordHash);
    }

    /** Roles of the platform, granted only to a person who signed in with a password. */
    public Set<String> getRoles() {
        return Arrays.stream(roles.split(","))
                .map(String::trim)
                .filter(role -> !role.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
    }

    public Instant getCreatedAt() {
        return createdAt;
    }
}
