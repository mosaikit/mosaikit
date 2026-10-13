// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.jobs;

import io.quarkus.arc.Arc;
import io.quarkus.arc.ArcContainer;
import io.quarkus.arc.Unremovable;
import jakarta.enterprise.context.RequestScoped;
import java.util.Optional;
import java.util.UUID;

/**
 * The work that the current context runs for an extension in an organization, without a person
 * (MK-126), when it is one: set by {@link OrganizationJobs}, read by the audit log to record the
 * channel {@code JOB} and the extension as actor.
 */
@RequestScoped
@Unremovable
public class OrganizationJob {

    private String extension;
    private UUID organization;

    void begin(String extension, UUID organization) {
        this.extension = extension;
        this.organization = organization;
    }

    /** The extension the work runs for, when the context is such work. */
    public Optional<String> extension() {
        return Optional.ofNullable(extension);
    }

    /** The organization the work acts on, when the context is such work. */
    public Optional<UUID> organization() {
        return Optional.ofNullable(organization);
    }

    /** The extension of the work that runs on this thread, if any; empty outside such work. */
    public static Optional<String> current() {
        ArcContainer container = Arc.container();
        if (container == null || !container.requestContext().isActive()) {
            return Optional.empty();
        }
        var job = container.instance(OrganizationJob.class);
        return job.isAvailable() ? job.get().extension() : Optional.empty();
    }
}
