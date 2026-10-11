// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.apps;

import dev.mosaikit.kernel.api.plugin.Contribution;
import dev.mosaikit.kernel.api.plugin.PluginManifest;
import dev.mosaikit.kernel.core.error.InvalidInputException;
import dev.mosaikit.kernel.core.plugin.InstalledPlugin;
import dev.mosaikit.kernel.core.plugin.PluginRegistry;
import dev.mosaikit.kernel.core.security.Roles;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.transaction.Transactional;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

/**
 * The apps of the app bar of each organization (MK-030): which ones appear, in which order, pinned
 * or not, for which roles. Without a setting an app appears to everyone, in the order of its
 * contribution, as in the shell.
 */
@ApplicationScoped
@Transactional
public class AppSettings {

    /** The points through which plugins add apps to the app bar (launcher.app is deprecated). */
    static final List<String> POINTS = List.of("rail.app", "launcher.app");

    private static final Set<String> ROLES = Set.of(Roles.ORGANIZATION_USER, Roles.ORGANIZATION_ADMIN);
    private static final int DEFAULT_ORDER = 100;

    private final PluginRegistry registry;
    private final OrganizationApps apps;

    public AppSettings(PluginRegistry registry, OrganizationApps apps) {
        this.registry = registry;
        this.apps = apps;
    }

    /** An app of an active plugin, as the shell would show it without settings. */
    record App(String pluginId, String appId, String title, int order) {}

    /** The apps of the active plugins, in the default order of the app bar. */
    List<App> available() {
        Set<String> routes = new HashSet<>();
        List<App> found = new ArrayList<>();
        for (String point : POINTS) {
            for (InstalledPlugin plugin : registry.active()) {
                for (PluginManifest manifest : plugin.manifest().stream().toList()) {
                    for (Contribution contribution : manifest.contributionsTo(point)) {
                        Object route = contribution.attributes().get("route");
                        if (!(route instanceof String text) || !routes.add(text)) {
                            continue;
                        }
                        Object title = contribution.attributes().get("title");
                        Object order = contribution.attributes().get("order");
                        found.add(new App(
                                manifest.id(),
                                contribution.id(),
                                title instanceof String name ? name : contribution.id(),
                                order instanceof Number number ? number.intValue() : DEFAULT_ORDER));
                    }
                }
            }
        }
        found.sort(Comparator.comparingInt(App::order));
        return found;
    }

    /** The apps of an organization with their settings, in the order of its app bar. */
    public List<AppView> list(UUID organizationId) {
        Map<String, OrganizationApp> settings = settingsOf(organizationId);
        List<App> available = new ArrayList<>(available());
        Map<String, Integer> defaultPosition = new HashMap<>();
        for (int i = 0; i < available.size(); i++) {
            defaultPosition.put(
                    key(available.get(i).pluginId(), available.get(i).appId()), i);
        }
        available.sort(Comparator.comparingInt(app -> {
            OrganizationApp setting = settings.get(key(app.pluginId(), app.appId()));
            // Apps without a setting, such as those of plugins installed later, come after.
            return setting == null
                    ? 10_000 + defaultPosition.get(key(app.pluginId(), app.appId()))
                    : setting.getPosition();
        }));
        return available.stream()
                .map(app -> Optional.ofNullable(settings.get(key(app.pluginId(), app.appId())))
                        .map(setting -> new AppView(
                                app.pluginId(),
                                app.appId(),
                                app.title(),
                                setting.isEnabled(),
                                setting.isPinned(),
                                setting.getRoles()))
                        .orElseGet(() -> new AppView(app.pluginId(), app.appId(), app.title(), true, false, Set.of())))
                .toList();
    }

    /** Replaces the settings of an organization; the order of the list is the order of the app bar. */
    public List<AppView> change(UUID organizationId, List<AppView> changed) {
        Set<String> known = new HashSet<>();
        available().forEach(app -> known.add(key(app.pluginId(), app.appId())));
        List<String> problems = new ArrayList<>();
        Set<String> seen = new HashSet<>();
        for (AppView app : changed) {
            String key = key(app.pluginId(), app.appId());
            if (!known.contains(key)) {
                problems.add("apps " + key + " is not an app of an active plugin");
            } else if (!seen.add(key)) {
                problems.add("apps " + key + " is listed twice");
            }
            if (!ROLES.containsAll(app.roles())) {
                problems.add("apps " + key + " has roles other than " + String.join(", ", ROLES));
            }
        }
        if (!problems.isEmpty()) {
            throw new InvalidInputException(problems);
        }
        apps.deleteByOrganizationId(organizationId);
        for (int i = 0; i < changed.size(); i++) {
            AppView app = changed.get(i);
            apps.insert(new OrganizationApp(
                    organizationId, app.pluginId(), app.appId(), app.enabled(), i, app.pinned(), app.roles()));
        }
        return list(organizationId);
    }

    /**
     * The apps that a person of an organization sees, in order: enabled, and for one of their roles.
     * Without an organization, every app.
     */
    public List<ShellApp> forPerson(Optional<UUID> organizationId, Set<String> roles) {
        if (organizationId.isEmpty()) {
            return available().stream()
                    .map(app -> new ShellApp(app.pluginId(), app.appId(), false))
                    .toList();
        }
        return list(organizationId.get()).stream()
                .filter(AppView::enabled)
                .filter(app -> app.roles().isEmpty() || app.roles().stream().anyMatch(roles::contains))
                .map(app -> new ShellApp(app.pluginId(), app.appId(), app.pinned()))
                .toList();
    }

    /**
     * Whether a plugin is turned off for an organization: it has apps, and all of them are off. Its
     * API and its documents then refuse the people of the organization.
     */
    public boolean isOff(UUID organizationId, String pluginId) {
        Map<String, OrganizationApp> settings = settingsOf(organizationId);
        List<App> ofPlugin = available().stream()
                .filter(app -> app.pluginId().equals(pluginId))
                .toList();
        return !ofPlugin.isEmpty()
                && ofPlugin.stream().allMatch(app -> {
                    OrganizationApp setting = settings.get(key(app.pluginId(), app.appId()));
                    return setting != null && !setting.isEnabled();
                });
    }

    private Map<String, OrganizationApp> settingsOf(UUID organizationId) {
        Map<String, OrganizationApp> settings = new LinkedHashMap<>();
        apps.findByOrganizationId(organizationId)
                .forEach(app -> settings.put(key(app.getPluginId(), app.getAppId()), app));
        return settings;
    }

    private static String key(String pluginId, String appId) {
        return pluginId + "/" + appId;
    }
}
