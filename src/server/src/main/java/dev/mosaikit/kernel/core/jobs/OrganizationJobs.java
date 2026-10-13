// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.jobs;

import dev.mosaikit.kernel.core.identity.OrganizationAccess;
import io.quarkus.arc.Arc;
import io.quarkus.arc.ArcContainer;
import io.quarkus.arc.InjectableContext;
import io.quarkus.arc.ManagedContext;
import io.quarkus.narayana.jta.QuarkusTransaction;
import io.quarkus.narayana.jta.QuarkusTransactionException;
import io.quarkus.security.identity.CurrentIdentityAssociation;
import io.quarkus.security.runtime.QuarkusPrincipal;
import io.quarkus.security.runtime.QuarkusSecurityIdentity;
import jakarta.enterprise.context.ApplicationScoped;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.Callable;

/**
 * Runs work of an extension for one organization outside any request, without a person (MK-126):
 * for now the handlers of events of the platform (MK-085). The work runs in a context of its own, as
 * a request would, whose organization is the given one and whose identity is anonymous, named after
 * the extension: the beans of the kernel ({@code CurrentOrganization}, resources, files, sharing,
 * quotas, audit) act in that organization, every connection runs as the member role under its
 * row-level security, what the work stores or registers belongs to the organization, and the audit
 * log records the extension as actor through the channel {@code JOB}.
 *
 * <p>The caller checks that the extension is active and not turned off in the organization: this
 * class only sets the context.
 */
@ApplicationScoped
public class OrganizationJobs {

    /**
     * Runs work for an extension in an organization, in a transaction of its own that rolls back when
     * the work throws. A context active on the thread, such as the one the scheduler opens, is set
     * aside meanwhile and comes back after.
     *
     * @throws Exception what the work threw
     */
    public <T> T run(String extension, UUID organization, Callable<T> work) throws Exception {
        Objects.requireNonNull(extension, "extension");
        Objects.requireNonNull(organization, "organization");
        return outsideRequests(() -> {
            ArcContainer container = Arc.container();
            ManagedContext requests = container.requestContext();
            requests.activate();
            try {
                container
                        .instance(CurrentIdentityAssociation.class)
                        .get()
                        .setIdentity(identity(extension, organization));
                container.instance(OrganizationJob.class).get().begin(extension, organization);
                return QuarkusTransaction.requiringNew().call(work);
            } catch (QuarkusTransactionException e) {
                throw e.getCause() instanceof Exception cause ? cause : e;
            } finally {
                requests.terminate();
            }
        });
    }

    /**
     * Runs work with no request context on the thread, as at start: the context that is active, such
     * as the one the scheduler opens for its jobs, is set aside meanwhile and comes back after. So the
     * connections the work takes are not those of a request without organization.
     */
    public static <T> T outsideRequests(Callable<T> work) throws Exception {
        ManagedContext requests = Arc.container().requestContext();
        if (!requests.isActive()) {
            return work.call();
        }
        InjectableContext.ContextState state = requests.getState();
        requests.deactivate();
        try {
            return work.call();
        } finally {
            requests.activate(state);
        }
    }

    /** No person, no role: the organization, and the extension as the name of the principal. */
    static QuarkusSecurityIdentity identity(String extension, UUID organization) {
        return QuarkusSecurityIdentity.builder()
                .setAnonymous(true)
                .setPrincipal(new QuarkusPrincipal(extension))
                .addAttribute(OrganizationAccess.ORGANIZATION_ATTRIBUTE, organization.toString())
                .build();
    }
}
