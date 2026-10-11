// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.apps;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.util.Arrays;
import java.util.Set;
import java.util.TreeSet;
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

    @Column(name = "plugin_id", nullable = false, updatable = false)
    private String pluginId;

    @Column(name = "app_id", nullable = false, updatable = false)
    private String appId;

    @Column(nullable = false)
    private boolean enabled;

    @Column(nullable = false)
    private int position;

    @Column(nullable = false)
    private boolean pinned;

    /** Comma-separated roles that see the app; empty for everyone. */
    @Column(nullable = false)
    private String roles;

    /** Required by JPA. */
    protected OrganizationApp() {}

    public OrganizationApp(
            UUID organizationId,
            String pluginId,
            String appId,
            boolean enabled,
            int position,
            boolean pinned,
            Set<String> roles) {
        this.id = UUID.randomUUID();
        this.organizationId = organizationId;
        this.pluginId = pluginId;
        this.appId = appId;
        this.enabled = enabled;
        this.position = position;
        this.pinned = pinned;
        this.roles = String.join(",", new TreeSet<>(roles));
    }

    public String getPluginId() {
        return pluginId;
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

    public Set<String> getRoles() {
        return roles.isBlank() ? Set.of() : Arrays.stream(roles.split(",")).collect(Collectors.toUnmodifiableSet());
    }
}
