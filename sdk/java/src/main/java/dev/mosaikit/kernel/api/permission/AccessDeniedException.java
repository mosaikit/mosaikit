// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.api.permission;

/**
 * The person of the request may not do what the request asks: they lack a permission (MK-056) or a
 * level on a resource (MK-055). The kernel answers it with {@code 403}, or with {@code 404} when the
 * exception is {@link #concealed()}, so that the existence of a resource the person may not see is
 * not revealed.
 */
public final class AccessDeniedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /** Whether the kernel answers {@code 404} instead of {@code 403}. */
    private final boolean concealed;

    /** Refused with {@code 403}. */
    public AccessDeniedException(String message) {
        this(message, false);
    }

    /**
     * Refused with {@code 404} when {@code concealed}, with {@code 403} otherwise.
     *
     * @param concealed whether the person may not even know that the object exists
     */
    public AccessDeniedException(String message, boolean concealed) {
        super(message);
        this.concealed = concealed;
    }

    /** Whether the person may not even know that the object exists: the kernel answers {@code 404}. */
    public boolean concealed() {
        return concealed;
    }
}
