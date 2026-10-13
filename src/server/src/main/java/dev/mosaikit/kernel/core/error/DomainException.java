// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

/**
 * A failure that the caller can understand and act on. Each subtype maps to one HTTP status and
 * is rendered as an RFC 9457 problem detail.
 */
public abstract sealed class DomainException extends RuntimeException
        permits ResourceNotFoundException,
                ConflictException,
                ForbiddenOperationException,
                ServiceUnavailableException,
                InvalidInputException {

    private static final long serialVersionUID = 1L;

    protected DomainException(String message) {
        super(message);
    }

    /** HTTP status code for this failure. */
    public abstract int status();

    /** Short, stable title of the problem type. */
    public abstract String title();
}
