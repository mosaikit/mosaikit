// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.apps;

import dev.mosaikit.kernel.core.security.Roles;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.Arrays;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

/** How an app of the app bar appears in an organization (MK-030). */
@Entity
@Table(name = "organization_app")
public class OrganizationApp {

    @Id
    private UUID id;

    @Column(name = "organization_id", nullable = false, updatable = false)
    private UUID organizationId;

    @Column(name = "extension_id", nullable = false, updatable = false)
    private String extensionId;

    @Column(name = "app_id", nullable = false, updatable = false)
    private String appId;

    @Column(nullable = false)
    private boolean enabled;

    @Column(nullable = false)
    private int position;

    @Column(nullable = false)
    private boolean pinned;

    /**
     * Comma-separated roles that saw the app before MK-056; now {@code organization-admin} when the
     * app is restricted to the people who hold its permission, and empty when everyone sees it. Rows
     * written before keep their meaning: the administrators hold every permission.
     */
    @Column(nullable = false)
    private String roles;

    /** Required by JPA. */
    protected OrganizationApp() {}

    public OrganizationApp(
            UUID organizationId,
            String extensionId,
            String appId,
            boolean enabled,
            int position,
            boolean pinned,
            boolean restricted) {
        this.id = UUID.randomUUID();
        this.organizationId = organizationId;
        this.extensionId = extensionId;
        this.appId = appId;
        this.enabled = enabled;
        this.position = position;
        this.pinned = pinned;
        this.roles = restricted ? Roles.ORGANIZATION_ADMIN : "";
    }

    public String getExtensionId() {
        return extensionId;
    }

    public String getAppId() {
        return appId;
    }

    public boolean isEnabled() {
        return enabled;
    }

    public int getPosition() {
        return position;
    }

    public boolean isPinned() {
        return pinned;
    }

    /**
     * Whether only the people who hold the permission of the app see it: the app was for the
     * administrators only, as rows written before MK-056 say with their roles.
     */
    public boolean isRestricted() {
        Set<String> found =
                roles.isBlank() ? Set.of() : Arrays.stream(roles.split(",")).collect(Collectors.toUnmodifiableSet());
        return found.contains(Roles.ORGANIZATION_ADMIN) && !found.contains(Roles.ORGANIZATION_USER);
    }
}
