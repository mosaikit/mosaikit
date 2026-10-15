// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.events;

import dev.mosaikit.kernel.api.events.PlatformEventSubscriber;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Any;
import jakarta.enterprise.inject.Instance;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Pattern;
import org.jboss.logging.Logger;

/**
 * The subscribers to events of the platform (MK-085): the beans of the Java code of extensions that
 * implement {@link PlatformEventSubscriber}, by key {@code <extension>/<name>}. Found once, at first
 * use: Java extensions change only with a restart of the kernel.
 */
@ApplicationScoped
public class EventSubscribers {

    private static final Logger LOG = Logger.getLogger(EventSubscribers.class);
    private static final Pattern NAME = Pattern.compile("^[a-z0-9][a-z0-9-]{0,63}$");

    private final Instance<PlatformEventSubscriber> beans;
    private final AtomicReference<Map<String, PlatformEventSubscriber>> found = new AtomicReference<>();

    public EventSubscribers(@Any Instance<PlatformEventSubscriber> beans) {
        this.beans = beans;
    }

    /** The keys of the subscribers to a type of event. */
    public List<String> of(String type) {
        return all().entrySet().stream()
                .filter(entry -> accepts(entry.getValue(), type))
                .map(Map.Entry::getKey)
                .toList();
    }

    /** The subscriber of a key, if the kernel has it now. */
    public Optional<PlatformEventSubscriber> find(String key) {
        return Optional.ofNullable(all().get(key));
    }

    /** The extension of the subscriber of a key. */
    static String extensionOf(String key) {
        return key.substring(0, key.lastIndexOf('/'));
    }

    private static boolean accepts(PlatformEventSubscriber subscriber, String type) {
        Set<String> types = subscriber.types();
        return types != null && types.contains(type);
    }

    private Map<String, PlatformEventSubscriber> all() {
        Map<String, PlatformEventSubscriber> current = found.get();
        if (current == null) {
            synchronized (found) {
                current = found.get();
                if (current == null) {
                    current = collect();
                    found.set(current);
                }
            }
        }
        return current;
    }

    private Map<String, PlatformEventSubscriber> collect() {
        Map<String, PlatformEventSubscriber> collected = new LinkedHashMap<>();
        for (PlatformEventSubscriber subscriber : beans) {
            String extension = subscriber.extension();
            String name = subscriber.name();
            if (extension == null || extension.isBlank() || extension.contains(",") || extension.contains("/")) {
                LOG.warnf("The subscriber %s names no valid extension: it receives no event", subscriber.getClass());
                continue;
            }
            if (name == null || !NAME.matcher(name).matches()) {
                LOG.warnf(
                        "The subscriber %s of %s has an invalid name '%s' (lowercase letters, digits and '-'):"
                                + " it receives no event",
                        subscriber.getClass(), extension, name);
                continue;
            }
            String key = extension + "/" + name;
            if (collected.putIfAbsent(key, subscriber) != null) {
                LOG.warnf(
                        "%s has two subscribers named %s: %s receives no event",
                        extension, name, subscriber.getClass());
            }
        }
        return Collections.unmodifiableMap(collected);
    }
}
