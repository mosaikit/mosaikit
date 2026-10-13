// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.teams;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
import java.io.Serializable;
import java.time.Instant;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

/** A person in a team, with their role (MK-032). */
@Entity
@Table(name = "team_member")
@IdClass(TeamMember.Key.class)
public class TeamMember {

    public static final String OWNER = "owner";
    public static final String MEMBER = "member";
    public static final String GUEST = "guest";
    public static final Set<String> ROLES = Set.of(OWNER, MEMBER, GUEST);

    /** The key of a person in a team. */
    public static class Key implements Serializable {
        private UUID teamId;
        private UUID accountId;

        /** Required by JPA. */
        public Key() {}

        public Key(UUID teamId, UUID accountId) {
            this.teamId = teamId;
            this.accountId = accountId;
        }

        @Override
        public boolean equals(Object other) {
            return other instanceof Key key
                    && Objects.equals(teamId, key.teamId)
                    && Objects.equals(accountId, key.accountId);
        }

        @Override
        public int hashCode() {
            return Objects.hash(teamId, accountId);
        }
    }

    @Id
    @Column(name = "team_id", nullable = false, updatable = false)
    private UUID teamId;

    @Id
    @Column(name = "account_id", nullable = false, updatable = false)
    private UUID accountId;

    @Column(nullable = false)
    private String role;

    @Column(name = "added_at", nullable = false, updatable = false)
    private Instant addedAt;

    /** Required by JPA. */
    protected TeamMember() {}

    public TeamMember(UUID teamId, UUID accountId, String role, Instant now) {
        this.teamId = teamId;
        this.accountId = accountId;
        this.role = role;
        this.addedAt = now;
    }

    void changeRole(String role) {
        this.role = role;
    }

    public UUID getTeamId() {
        return teamId;
    }

    public UUID getAccountId() {
        return accountId;
    }

    public String getRole() {
        return role;
    }

    public Instant getAddedAt() {
        return addedAt;
    }
}
