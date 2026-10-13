// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.permissions;

import dev.mosaikit.kernel.api.permission.PermissionId;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A permission of an extension granted in an organization (MK-056) to exactly one subject: a
 * profile, a team, or a member as a personal exception.
 */
@Entity
@Table(name = "permission_grant")
public class PermissionGrant {

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    @Column(name = "extension_id", nullable = false, updatable = false)
    private String extensionId;

    @Column(name = "permission", nullable = false, updatable = false)
    private String permission;

    @Column(name = "profile_id", updatable = false)
    private UUID profileId;

    @Column(name = "team_id", updatable = false)
    private UUID teamId;

    @Column(name = "account_id", updatable = false)
    private UUID accountId;

    @Column(name = "granted_at", nullable = false, updatable = false)
    private Instant grantedAt;

    /** Required by JPA. */
    protected PermissionGrant() {}

    private PermissionGrant(
            UUID organizationId, PermissionId permission, UUID profileId, UUID teamId, UUID accountId, Instant now) {
        this.id = UUID.randomUUID();
        this.organizationId = organizationId;
        this.extensionId = permission.extension();
        this.permission = permission.name();
        this.profileId = profileId;
        this.teamId = teamId;
        this.accountId = accountId;
        this.grantedAt = now;
    }

    /** A permission of a profile. */
    public static PermissionGrant toProfile(UUID organizationId, UUID profileId, PermissionId permission, Instant now) {
        return new PermissionGrant(organizationId, permission, profileId, null, null, now);
    }

    /** A permission granted to a team. */
    public static PermissionGrant toTeam(UUID organizationId, UUID teamId, PermissionId permission, Instant now) {
        return new PermissionGrant(organizationId, permission, null, teamId, null, now);
    }

    /** A permission granted to a member as a personal exception. */
    public static PermissionGrant toMember(UUID organizationId, UUID accountId, PermissionId permission, Instant now) {
        return new PermissionGrant(organizationId, permission, null, null, accountId, now);
    }

    /** The qualified identifier of the permission. */
    public PermissionId permissionId() {
        return new PermissionId(extensionId, permission);
    }

    public UUID getId() {
        return id;
    }

    public UUID getOrganizationId() {
        return organizationId;
    }

    public String getExtensionId() {
        return extensionId;
    }

    public String getPermission() {
        return permission;
    }

    public UUID getProfileId() {
        return profileId;
    }

    public UUID getTeamId() {
        return teamId;
    }

    public UUID getAccountId() {
        return accountId;
    }

    public Instant getGrantedAt() {
        return grantedAt;
    }
}
