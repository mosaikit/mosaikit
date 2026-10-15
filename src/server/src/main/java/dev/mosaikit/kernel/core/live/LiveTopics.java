// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.live;

import dev.mosaikit.kernel.core.apps.AppSettings;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import dev.mosaikit.kernel.core.extension.InstalledExtension;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Which topics a person may subscribe to (MK-031): the changes of the documents of a collection of
 * an active extension, the events of an active extension, their own notifications, and the extensions
 * that become active or inactive in their organization (MK-133). The extensions
 * that the organization turned off are refused, as their API is (MK-030).
 */
@ApplicationScoped
public class LiveTopics {

    /** The notifications of the person (MK-038). */
    public static final String NOTIFICATIONS = "notifications";

    /**
     * The extensions that become active or inactive in the organization (MK-133): data
     * {@code extension}, {@code version}, {@code active}, {@code reason}, and {@code previousVersion}
     * after an update.
     */
    public static final String EXTENSIONS = "extensions";

    static final Pattern DOCUMENTS = Pattern.compile("^documents\\.([a-z0-9][a-z0-9.-]*)\\.([a-z][a-z0-9-]{0,63})$");
    static final Pattern EXTENSION = Pattern.compile("^extension\\.([a-z0-9][a-z0-9.-]*?)\\.([a-z][a-z0-9.-]{0,99})$");

    private final ExtensionRegistry registry;
    private final AppSettings apps;

    public LiveTopics(ExtensionRegistry registry, AppSettings apps) {
        this.registry = registry;
        this.apps = apps;
    }

    /** Why a person may not subscribe to a topic, or empty when they may. */
    public Optional<String> refusal(String topic, Optional<UUID> organization) {
        if (NOTIFICATIONS.equals(topic)) {
            return Optional.empty();
        }
        if (organization.isEmpty()) {
            return Optional.of("choose an organization: the topics of extensions belong to one");
        }
        if (EXTENSIONS.equals(topic)) {
            return Optional.empty();
        }
        Matcher documents = DOCUMENTS.matcher(topic);
        if (documents.matches()) {
            return extensionRefusal(documents.group(1), organization.get())
                    .or(() -> declares(documents.group(1), documents.group(2))
                            ? Optional.empty()
                            : Optional.of("the extension declares no such collection"));
        }
        Matcher extension = EXTENSION.matcher(topic);
        if (extension.matches()) {
            return registry.active().stream()
                    .flatMap(installed -> installed.manifest().stream())
                    .map(manifest -> manifest.id())
                    .filter(id -> topic.startsWith("extension." + id + "."))
                    .findFirst()
                    .map(id -> extensionRefusal(id, organization.get()))
                    .orElse(Optional.of("no active extension has this topic"));
        }
        return Optional.of("not a topic of the real-time channel");
    }

    private Optional<String> extensionRefusal(String extensionId, UUID organization) {
        Optional<InstalledExtension> extension = registry.findActive(extensionId);
        if (extension.isEmpty()) {
            return Optional.of("the extension is not active");
        }
        if (apps.isOff(organization, extensionId)) {
            return Optional.of("the extension is turned off for the organization");
        }
        return Optional.empty();
    }

    private boolean declares(String extensionId, String collection) {
        return registry.findActive(extensionId)
                .flatMap(InstalledExtension::manifest)
                .flatMap(manifest -> manifest.data())
                .filter(data -> data.declares(collection))
                .isPresent();
    }
}
