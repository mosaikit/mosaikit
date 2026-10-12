// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.context;

import java.util.Optional;
import java.util.UUID;

/**
 * The organization the current request acts on (MK-017). A person may belong to several
 * organizations; every request acts on one of them, chosen by the sub-domain, by the organization
 * selector of the shell or by the realm the person signed in with, and only if the person is a
 * member and the organization accepts the way the person signed in.
 *
 * <p>The kernel provides this bean to extensions; the requests that reach an extension API always have an
 * organization. An extension reads and writes only the data of {@link #require()}, so that data of
 * other organizations are never visible.
 */
public interface CurrentOrganization {

    /** Identifier of the organization, when the request has one. */
    Optional<UUID> id();

    /** Slug of the organization, when the request has one. */
    Optional<String> slug();

    /**
     * The identifier of the organization.
     *
     * @throws NoOrganizationException when the request has no organization; the kernel answers it
     *     with {@code 403}
     */
    default UUID require() {
        return id().orElseThrow(NoOrganizationException::new);
    }
}
