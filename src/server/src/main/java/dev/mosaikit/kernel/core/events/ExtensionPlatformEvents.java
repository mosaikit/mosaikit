// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.events;

import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.api.events.PlatformEvents;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * The events of the platform offered to extensions (MK-085): an extension raises its own events,
 * {@code <extension>:<name>}, in the organization of the request and in its transaction.
 */
@ApplicationScoped
public class ExtensionPlatformEvents implements PlatformEvents {

    private static final Pattern NAME = Pattern.compile("^[a-z][a-z0-9.-]{0,63}$");

    /** Longest type, extension and {@code :} included, as the column holds it. */
    static final int MAX_TYPE = 120;

    private final PlatformEventLog log;
    private final ExtensionRegistry extensions;
    private final CurrentOrganization organization;

    public ExtensionPlatformEvents(
            PlatformEventLog log, ExtensionRegistry extensions, CurrentOrganization organization) {
        this.log = log;
        this.extensions = extensions;
        this.organization = organization;
    }

    @Override
    public void raise(String extension, String name, Map<String, ?> payload) {
        if (extension == null || extensions.findActive(extension).isEmpty()) {
            throw new IllegalArgumentException(extension + " is not an active extension");
        }
        if (name == null || !NAME.matcher(name).matches()) {
            throw new IllegalArgumentException(
                    "The name of an event must be lowercase letters, digits, '.' and '-', such as note.created");
        }
        String type = extension + ":" + name;
        if (type.length() > MAX_TYPE) {
            throw new IllegalArgumentException(
                    "The type of an event, with the extension, must be at most " + MAX_TYPE + " characters: " + type);
        }
        if (log.write(payload).length() > MAX_PAYLOAD) {
            throw new IllegalArgumentException("The payload must be at most " + MAX_PAYLOAD + " characters as JSON");
        }
        UUID org = organization.require();
        log.raise(org, type, extension, payload);
    }
}
