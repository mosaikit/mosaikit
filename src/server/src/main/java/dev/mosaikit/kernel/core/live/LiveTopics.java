// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.live;

import dev.mosaikit.kernel.core.apps.AppSettings;
import dev.mosaikit.kernel.core.plugin.InstalledPlugin;
import dev.mosaikit.kernel.core.plugin.PluginRegistry;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Which topics a person may subscribe to (MK-031): the changes of the documents of a collection of
 * an active plugin, the events of an active plugin, and their own notifications. The plugins
 * that the organization turned off are refused, as their API is (MK-030).
 */
@ApplicationScoped
public class LiveTopics {

    /** The notifications of the person (MK-038). */
    public static final String NOTIFICATIONS = "notifications";

    static final Pattern DOCUMENTS = Pattern.compile("^documents\\.([a-z0-9][a-z0-9.-]*)\\.([a-z][a-z0-9-]{0,63})$");
    static final Pattern PLUGIN = Pattern.compile("^plugin\\.([a-z0-9][a-z0-9.-]*?)\\.([a-z][a-z0-9.-]{0,99})$");

    private final PluginRegistry registry;
    private final AppSettings apps;

    public LiveTopics(PluginRegistry registry, AppSettings apps) {
        this.registry = registry;
        this.apps = apps;
    }

    /** Why a person may not subscribe to a topic, or empty when they may. */
    public Optional<String> refusal(String topic, Optional<UUID> organization) {
        if (NOTIFICATIONS.equals(topic)) {
            return Optional.empty();
        }
        if (organization.isEmpty()) {
            return Optional.of("choose an organization: the topics of plugins belong to one");
        }
        Matcher documents = DOCUMENTS.matcher(topic);
        if (documents.matches()) {
            return pluginRefusal(documents.group(1), organization.get())
                    .or(() -> declares(documents.group(1), documents.group(2))
                            ? Optional.empty()
                            : Optional.of("the plugin declares no such collection"));
        }
        Matcher plugin = PLUGIN.matcher(topic);
        if (plugin.matches()) {
            return registry.active().stream()
                    .flatMap(installed -> installed.manifest().stream())
                    .map(manifest -> manifest.id())
                    .filter(id -> topic.startsWith("plugin." + id + "."))
                    .findFirst()
                    .map(id -> pluginRefusal(id, organization.get()))
                    .orElse(Optional.of("no active plugin has this topic"));
        }
        return Optional.of("not a topic of the real-time channel");
    }

    private Optional<String> pluginRefusal(String pluginId, UUID organization) {
        Optional<InstalledPlugin> plugin = registry.findActive(pluginId);
        if (plugin.isEmpty()) {
            return Optional.of("the plugin is not active");
        }
        if (apps.isOff(organization, pluginId)) {
            return Optional.of("the plugin is turned off for the organization");
        }
        return Optional.empty();
    }

    private boolean declares(String pluginId, String collection) {
        return registry.findActive(pluginId)
                .flatMap(InstalledPlugin::manifest)
                .flatMap(manifest -> manifest.data())
                .filter(data -> data.declares(collection))
                .isPresent();
    }
}
