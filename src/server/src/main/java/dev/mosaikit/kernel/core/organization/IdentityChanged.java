// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.organization;

import java.util.UUID;

/**
 * CDI event fired when an organization is created or changes how it signs in.
 *
 * @param organizationId the organization
 */
public record IdentityChanged(UUID organizationId) {}
