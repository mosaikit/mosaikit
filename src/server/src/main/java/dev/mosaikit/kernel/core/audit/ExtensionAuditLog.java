// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.audit;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.mosaikit.kernel.api.audit.AuditLog.Entry;
import dev.mosaikit.kernel.api.context.CurrentOrganization;
import dev.mosaikit.kernel.core.extension.ExtensionRegistry;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Optional;
import java.util.UUID;

/**
 * The audit log offered to extensions (MK-059): an entry of the organization of the request, by its
 * person, through the channel {@code EXTENSION}, with the action qualified by the extension.
 */
@ApplicationScoped
public class ExtensionAuditLog implements dev.mosaikit.kernel.api.audit.AuditLog {

    /** The actor of an entry recorded in a request without a person. */
    static final String SYSTEM = "system";

    private final AuditLog log;
    private final ExtensionRegistry extensions;
    private final CurrentOrganization organization;
    private final SecurityIdentity identity;
    private final ObjectMapper json;

    public ExtensionAuditLog(
            AuditLog log,
            ExtensionRegistry extensions,
            CurrentOrganization organization,
            SecurityIdentity identity,
            ObjectMapper json) {
        this.log = log;
        this.extensions = extensions;
        this.organization = organization;
        this.identity = identity;
        this.json = json;
    }

    @Override
    public void record(String extension, Entry entry) {
        if (entry == null) {
            throw new IllegalArgumentException("The entry is required");
        }
        if (extension == null || extensions.findActive(extension).isEmpty()) {
            throw new IllegalArgumentException(extension + " is not an active extension");
        }
        String action = extension + ":" + entry.action();
        if (action.length() > MAX_QUALIFIED_ACTION) {
            throw new IllegalArgumentException("The action, with the identifier of the extension, must be at most "
                    + MAX_QUALIFIED_ACTION + " characters: " + action);
        }
        if (length(entry) > MAX_DETAILS) {
            throw new IllegalArgumentException("The details must be at most " + MAX_DETAILS + " characters as JSON");
        }
        UUID org = organization.require();
        String actor = identity.isAnonymous() ? SYSTEM : identity.getPrincipal().getName();
        log.append(
                AuditEvent.Channel.EXTENSION,
                actor,
                Optional.of(org),
                action,
                entry.object(),
                AuditEvent.Outcome.valueOf(entry.outcome().name()),
                entry.details());
    }

    private int length(Entry entry) {
        try {
            return json.writeValueAsString(entry.details()).length();
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("The details must be writable as JSON: " + e.getOriginalMessage(), e);
        }
    }
}
