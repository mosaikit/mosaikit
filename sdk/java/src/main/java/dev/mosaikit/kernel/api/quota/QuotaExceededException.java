// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.quota;

import java.util.Objects;

/**
 * An action would take the organization beyond one of its quotas (MK-076). Let it go out of the
 * resource of the extension: the kernel answers {@code 403 Quota exceeded}, a problem detail that
 * names the limit in its text and in the member {@code quota}.
 */
public final class QuotaExceededException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final transient Quota quota;

    public QuotaExceededException(String message, Quota quota) {
        super(message);
        this.quota = Objects.requireNonNull(quota, "quota");
    }

    /** The quota that refused the action, with its limit and what was used. */
    public Quota quota() {
        return quota;
    }
}
