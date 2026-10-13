// SPDX-FileCopyrightText: 2026 Massimo Antonini
// SPDX-License-Identifier: MPL-2.0
package dev.mosaikit.kernel.core.error;

/** The operation is not allowed for the current account or organization. */
public final class ForbiddenOperationException extends DomainException {

    private static final long serialVersionUID = 1L;

    public ForbiddenOperationException(String message) {
        super(message);
    }

    @Override
    public int status() {
        return 403;
    }

    @Override
    public String title() {
        return "Operation not allowed";
    }
}
