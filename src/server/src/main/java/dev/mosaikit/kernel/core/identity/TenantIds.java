// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.identity;

import java.util.Optional;

/**
 * Identifiers of the OIDC tenants of organizations: {@code org/<slug>/<realm>}. The realm is
 * part of the identifier so that changing the realm of an organization creates a new tenant.
 */
final class TenantIds {

    private static final String PREFIX = "org/";

    private TenantIds() {}

    static String of(String slug, String realm) {
        return PREFIX + slug + "/" + realm;
    }

    /** The organization slug of a tenant identifier, when it is the tenant of an organization. */
    static Optional<String> slug(String tenantId) {
        if (tenantId == null || !tenantId.startsWith(PREFIX)) {
            return Optional.empty();
        }
        int end = tenantId.indexOf('/', PREFIX.length());
        return end <= PREFIX.length() ? Optional.empty() : Optional.of(tenantId.substring(PREFIX.length(), end));
    }
}
